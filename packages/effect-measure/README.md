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

`meters`, `kilometers`, and `miles` accept every finite nonnegative JavaScript number, including zero. They return `None` for negative values, `NaN`, and either infinity. Construction reads the number's decimal representation, including scientific notation, and stores the result in meters with exact decimal scaling. This preserves submillimeter differences and supports distances whose stored value exceeds the JavaScript number range.

`Distance.equals` and `Distance.Order` compare the stored decimal values. One mile, 1,609.344 meters, and 1.609344 kilometers compare equal. Distinct distances can compare differently even when their numeric conversions coincide.

`toMeters`, `toKilometers`, and `toMiles` convert to the requested unit in decimal arithmetic before returning a JavaScript number. Converting to miles can round a repeating decimal quotient. The returned number can round, underflow to zero, or overflow to positive infinity. The stored distance retains its precision.
