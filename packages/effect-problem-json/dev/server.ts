import { createServer } from 'node:http'
import { NodeRuntime } from '@effect/platform-node'
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Context, Effect, Layer, Schema } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import {
	HttpApi,
	HttpApiBuilder,
	HttpApiEndpoint,
	HttpApiGroup,
	HttpApiSchema,
	HttpApiSwagger,
} from 'effect/unstable/httpapi'
import * as ProblemJson from '../src/ProblemJson.ts'

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

class Todo extends Schema.Class<Todo>('Todo')({
	id: Schema.Number,
	title: Schema.String,
	completed: Schema.Boolean,
}) {}

class CreateTodo extends Schema.Class<CreateTodo>('CreateTodo')({
	title: Schema.String,
}) {}

class UpdateTodo extends Schema.Class<UpdateTodo>('UpdateTodo')({
	title: Schema.optional(Schema.String),
	completed: Schema.optional(Schema.Boolean),
}) {}

// ---------------------------------------------------------------------------
// Error definitions — pre-built and custom via makeErrorClass
// ---------------------------------------------------------------------------

const DuplicateTodoTitle = ProblemJson.makeErrorClass('DuplicateTodoTitle', 422, {
	existingTodoId: Schema.Number,
})

// ---------------------------------------------------------------------------
// Todo Repository (in-memory)
// ---------------------------------------------------------------------------

class TodoRepo extends Context.Service<
	TodoRepo,
	{
		readonly list: Effect.Effect<Array<Todo>>
		readonly getById: (
			id: number,
		) => Effect.Effect<Todo, InstanceType<typeof ProblemJson.NotFound.Error>>
		readonly create: (
			input: CreateTodo,
		) => Effect.Effect<Todo, InstanceType<typeof DuplicateTodoTitle.Error>>
		readonly update: (
			id: number,
			input: UpdateTodo,
		) => Effect.Effect<Todo, InstanceType<typeof ProblemJson.NotFound.Error>>
		readonly remove: (
			id: number,
		) => Effect.Effect<void, InstanceType<typeof ProblemJson.NotFound.Error>>
	}
>()('TodoRepo') {}

const TodoRepoLive = Layer.sync(TodoRepo)(() => {
	let nextId = 1
	const todos = new Map<number, Todo>()
	const seed = new Todo({ id: nextId++, title: 'Learn Effect v4 HttpApi', completed: false })
	todos.set(seed.id, seed)

	return {
		list: Effect.sync(() => [...todos.values()]),

		getById: (id: number) =>
			Effect.suspend(() => {
				const todo = todos.get(id)
				return todo
					? Effect.succeed(todo)
					: Effect.fail(ProblemJson.NotFound.make({ detail: `Todo with id ${id} was not found` }))
			}),

		create: (input: typeof CreateTodo.Type) =>
			Effect.suspend(() => {
				const duplicate = [...todos.values()].find((t) => t.title === input.title)
				if (duplicate)
					return Effect.fail(
						DuplicateTodoTitle.make({
							detail: `A todo with the title '${input.title}' already exists`,
							existingTodoId: duplicate.id,
						}),
					)
				const id = nextId++
				const todo = new Todo({ id, title: input.title, completed: false })
				todos.set(id, todo)
				return Effect.succeed(todo)
			}),

		update: (id: number, input: typeof UpdateTodo.Type) =>
			Effect.suspend(() => {
				const existing = todos.get(id)
				if (!existing)
					return Effect.fail(
						ProblemJson.NotFound.make({ detail: `Todo with id ${id} was not found` }),
					)
				const updated = new Todo({
					id: existing.id,
					title: input.title ?? existing.title,
					completed: input.completed ?? existing.completed,
				})
				todos.set(id, updated)
				return Effect.succeed(updated)
			}),

		remove: (id: number) =>
			Effect.suspend(() => {
				if (!todos.has(id))
					return Effect.fail(
						ProblemJson.NotFound.make({ detail: `Todo with id ${id} was not found` }),
					)
				todos.delete(id)
				return Effect.void
			}),
	}
})

// ---------------------------------------------------------------------------
// API Definition
// ---------------------------------------------------------------------------

const todosGroup = HttpApiGroup.make('todos')
	.add(
		HttpApiEndpoint.get('listTodos', '/todos', {
			success: Schema.Array(Todo),
		}),
	)
	.add(
		HttpApiEndpoint.get('getTodo', '/todos/:id', {
			params: { id: Schema.NumberFromString },
			success: Todo,
			error: ProblemJson.NotFound.problem,
		}),
	)
	.add(
		HttpApiEndpoint.post('createTodo', '/todos', {
			payload: CreateTodo,
			success: Todo.pipe(HttpApiSchema.status(201)),
			error: DuplicateTodoTitle.problem,
		}),
	)
	.add(
		HttpApiEndpoint.put('updateTodo', '/todos/:id', {
			params: { id: Schema.NumberFromString },
			payload: UpdateTodo,
			success: Todo,
			error: ProblemJson.NotFound.problem,
		}),
	)
	.add(
		HttpApiEndpoint.delete('deleteTodo', '/todos/:id', {
			params: { id: Schema.NumberFromString },
			error: ProblemJson.NotFound.problem,
		}),
	)

const api = HttpApi.make('TodoApi').add(todosGroup)
// .annotate(OpenApi.Transform, ProblemJson.openApiTransform)

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const TodosLive = HttpApiBuilder.group(api, 'todos', (handlers) =>
	Effect.gen(function* () {
		const repo = yield* TodoRepo

		return handlers
			.handle('listTodos', () => repo.list)
			.handle('getTodo', ({ params }) => repo.getById(params.id))
			.handle('createTodo', ({ payload }) => repo.create(payload))
			.handle('updateTodo', ({ params, payload }) => repo.update(params.id, payload))
			.handle('deleteTodo', ({ params }) => repo.remove(params.id))
	}),
).pipe(Layer.provide(TodoRepoLive))

// ---------------------------------------------------------------------------
// Manual validation route (demonstrates ProblemJson.fromSchemaError)
// ---------------------------------------------------------------------------

const ContactForm = Schema.Struct({
	email: Schema.String.check(Schema.isIncludes('@')),
	age: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
	name: Schema.String.check(Schema.isMinLength(1)),
})

const ManualValidateRoute = HttpRouter.add('POST', '/manual-validate', (request) =>
	Effect.gen(function* () {
		const body = yield* request.json
		return yield* Schema.decodeUnknownEffect(ContactForm)(body).pipe(
			Effect.map((data) => HttpServerResponse.jsonUnsafe({ ok: true, data })),
			Effect.catchTag('SchemaError', (error) => Effect.succeed(ProblemJson.fromSchemaError(error))),
		)
	}),
)

// ---------------------------------------------------------------------------
// Middleware-only validation route (SchemaError caught by global middleware)
// ---------------------------------------------------------------------------

const MiddlewareValidateRoute = HttpRouter.add('POST', '/middleware-validate', (request) =>
	Effect.gen(function* () {
		const body = yield* request.json
		const data = yield* Schema.decodeUnknownEffect(ContactForm)(body)
		return HttpServerResponse.jsonUnsafe({ ok: true, data })
	}),
)

const SwaggerLive = HttpApiSwagger.layer(api, { path: '/docs' })

const ServerLive = NodeHttpServer.layer(createServer, { port: 3000 })

const AppLive = HttpRouter.serve(
	Layer.mergeAll(
		Layer.provide(HttpApiBuilder.layer(api, { openapiPath: '/openapi.json' }), [TodosLive]),
		SwaggerLive,
		ManualValidateRoute,
		MiddlewareValidateRoute,
		ProblemJson.middleware(),
	),
).pipe(Layer.provide(ServerLive))

const logStartup = Effect.gen(function* () {
	yield* Effect.log('Server running at http://localhost:3000')
	yield* Effect.log('Swagger UI at http://localhost:3000/docs')
	yield* Effect.log('OpenAPI spec at http://localhost:3000/openapi.json')
	yield* Effect.log(`
Try it out:
  curl http://localhost:3000/todos
  curl http://localhost:3000/todos/1
  curl http://localhost:3000/todos/999
  curl -X POST http://localhost:3000/todos -H 'Content-Type: application/json' -d '{"title":"Buy milk"}'
  curl -X POST http://localhost:3000/todos -H 'Content-Type: application/json' -d '{"title":"Learn Effect v4 HttpApi"}'  # 422 duplicate with extension
  curl -X POST http://localhost:3000/todos -H 'Content-Type: application/json' -d '{"bad":"field"}'
  curl -X PUT http://localhost:3000/todos/1 -H 'Content-Type: application/json' -d '{"completed":true}'
  curl -X DELETE http://localhost:3000/todos/1
  curl -X POST http://localhost:3000/manual-validate -H 'Content-Type: application/json' -d '{"email":"bad","age":-1,"name":""}'
  curl -X POST http://localhost:3000/manual-validate -H 'Content-Type: application/json' -d '{"email":"a@b.com","age":25,"name":"Alice"}'
  curl -X POST http://localhost:3000/middleware-validate -H 'Content-Type: application/json' -d '{"email":"bad","age":-1,"name":""}'  # caught by global middleware`)
})

Layer.mergeAll(AppLive, Layer.effectDiscard(logStartup)).pipe(Layer.launch, NodeRuntime.runMain)
