## Formulae for general wear:

Assume all durations are seconds, & all timestamps are unix time in seconds

### Inputs:

* `category`:
  * `initial_target_wear`
  * `initial_max_wear`
  * `risk_levels`
  * `break_grace_time` (new, defaults to 24h for all existing. UI for new/updated categories)
  * `break_decay_multiplier` - some x where 0 <= x < 1. Defaults to 0.91
  * `minimum_rest`
  * `rest_multiplier`

* `item`:
  * `difficulty_modifier`

* `previous_session`:
  * `elapsed` - total time elapsed over the session
  * `target` - target time recorded at start of session
  * `max` - max time recorded at start of session
  * `start_time` - timestamp that last session started
  * `end_time` - timestamp that last session *actually* ended
  * `rest_seconds` - calculated time user should rest before wearing another item from this category

### Derived data:

I don't think these ideas have been named anywhere yet, but they are derivable
data that could be placed on the model class but not stored, or just used
as functions or local variables in some calculator service object.

* `previous_session`:
  * `earliest_start`: `end_time + rest_seconds`
  * `latest_start`: `earliest_start + category.break_grace_time`

* `item`:
  * `difficulty_modifier`: `1 / difficulty` — the user enters difficulty as a
    percentage (e.g. 150% = harder); the modifier is its reciprocal, so a 150%
    item is worn for ~66% as long. All wear durations below use
    `difficulty_modifier`, never the raw user-entered difficulty.

* `new_session`:
  * `time_ago`: `start_time - previous_session.end_time`
  * `time_since_grace`: `start_time - previous_session.latest_start`
  * `days_since_grace`: `floor(time_since_grace / 86400)`

`previous_session` is the most recently ended session for **any item in this
category** (not just the item being started). The current item's
`difficulty_modifier` is applied to that previous session's target/max.

### Situations

Session started:

1. for first ever time for that category
2. after a previous session
  a. inside rest period
  b. after rest period, before long break period
  c. inside long break period

Session ended:
3. in injury
4. earlier than target
5. later than target AND (if there is a maximum, earlier than maximum)
6. if there is a maximum, after the maximum

### Outputs required:

All on the current Session:

at Session start:
  * `start_time` - time that the session began
  * `target` - target time recorded at start of session
  * `max` - max time recorded at start of session

at Session end:
  * `elapsed` - total time elapsed over the session.
  * `end_time` - timestamp that the session ended
  * `rest_seconds` - calculated time user should rest before wearing another item from this category


### Formulae

All rules are evaluated in order (each separate list item after the last)

`pow(base, exponent)` is exponentiation. `base ** exponent` in Ruby

#### Session Start

Rules evaluated at start of session (and when querying current,
 to get *expected* durations *if* you were to start a session now)

Overriding rule for max: if `category.initial_max_wear` is null, `max = null`.
Never calculate a value for `max` if `category.initial_max_wear` is null.

* First
  ```
  start_time = now()
  ```

* If `previous_session` exists:
  * If `start_time < previous_session.earliest_start`
    ```
    target = previous_session.target / 2
    max = previous_session.max / 2
    ```

    Else: (`start_time >= previous_session.earliest_start`)
    ```
    target = item.difficulty_modifier * (previous_session.target + category.initial_target)
    max    = item.difficulty_modifier * (previous_session.max + category.initial_max)
    ```

  * If `start_time > previous_session.latest_start`:
    Decay applies once per full day since grace ended (`new_session.days_since_grace`).
    Each day's loss amount is itself floored, so `target`/`max` reach
    `category.initial_target`/`category.initial_max` in a bounded number of
    days instead of trailing off asymptotically:
    ```
    loss_fraction = 1 - category.break_decay_multiplier

    for day in 1..new_session.days_since_grace:
      target_loss = max(loss_fraction * target, category.initial_target)
      target = max(target - target_loss, category.initial_target)

      # only when category has a max:
      max_loss = max(loss_fraction * max, category.initial_max)
      max = max(max - max_loss, category.initial_max)
    ```

  Else: (`previous_session` does not exist)
  ```
  target = item.difficulty_modifier * category.initial_target
  max    = item.difficulty_modifier * category.initial_max
  ```

* If an injury is active for this category:
  ```
  target /= 2
  max /= 2
  ```

#### Session End

`elapsed` and `end_time` are self-evident, so only `rest_seconds` needs calculating.

If session ended in injury, set an active injury for this category.

* Find the risk level for the `elapsed` time for this session's category. Each
  risk band carries its own `rest_weight` — a precomputed scalar so the rest
  formula needs no knowledge of index or band count. For a band at `index`
  (0 = lowest) within `count` bands:
  ```
  rest_weight = count > 1 ? 2 * (index / (count - 1)) : 0
  ```
  The lowest band contributes `rest_weight = 0`; the highest contributes `2`.

* Unconditionally:
  ```
  combined_multiplier = (1 + risk_level.rest_weight) * category.rest_multiplier
  rest_seconds = elapsed * combined_multiplier
  ```
* If you went over the maximum time for this session (elapsed > max)
  ```
  seconds_over = elapsed - max
  rest_seconds += seconds_over * 2
  ```

* Unconditionally:
  ```
  rest_seconds = larger_of(rest_seconds, (category.initial_max_wear ? category.minimum_rest : 0))
  ```

* If there is an active injury for this category
  ```
  rest_seconds *= 1.5
  ```
























## LEGACY DESIGN DOC

Formula for duration of butt plug wearing:

Time(wear)0 = 15 to 30 mins
Time(wear)k+1 = Time(wear)k
T0 = 15 - 30 mins
Tk+1 = Tk + T0

risk = case Time(wear)
       when > 4h, <= 8h
         6
       when > 8h
         12
       end

Time(rest) = Time(wear) * risk + 24h

If injury occurs during a wear period, rest until symptoms no longer persist.

Breaks below are for time *over* the "rest" period

Break < 1 Week: You may be able to resume at roughly 75-80% of your previous maximum duration/size, but proceed with extreme caution. Monitor for any tightness.
Break 1-4 Weeks: Assume you have lost significant tolerance. Start at 50% of your previous maximum duration and one size smaller than your last active size.
Break > 1 Month: Treat yourself as a complete beginner. Start with the smallest size and shortest duration (15 minutes) as if you have never done this before.
