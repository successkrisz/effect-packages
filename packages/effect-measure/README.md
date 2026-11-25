# effect-measure

Physical measurement values for Effect. The `Distance` module constructs, compares, and converts nonnegative lengths in meters, kilometers, and miles.

```ts
import { Option } from 'effect'
import { Distance } from 'effect-measure'

const route = Option.getOrThrow(Distance.meters(1750))
const threshold = Option.getOrThrow(Distance.kilometers(2))

const isUnderThreshold = Distance.Order(route, threshold) < 0
const routeInMiles = Distance.toMiles(route)
```

You can also import individual exports, such as `meters` and `toMiles`, from `effect-measure/Distance`.
