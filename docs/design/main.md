Goal
====

A single-user Progress Web App for tracking & motivating the user in the
duration they wear certain categories of item.

For each category of item, they have an initial wear time, a target wear time,
a curve, or perhaps look-up-table, of wear length increments, and rest periods
based on the wear time. See the docs/design/duration-formula.md for the wear
time formula for one category of item.

The app, by default, will present a two-pane view to the user. The top pane is
an "at-a-glance" style view indicating what they "should" currently be doing
(wearing/resting for each of their categories of item) and what they should be
doing next (i.e. how long until they should cease wearing an item or when they
are next eligible to wear an item), and buttons to indicate that they have
started/stopped wearing an item, or whether they have incurred injury with that
item. An incurred injury must be treated as "stopped wearing", plus disable the
button to indicate the item is being worn again until a new button which
indicates the injury has healed is clicked.

While the user has any injury, the wear duration of each other category of item
is halved, and the rest periods are at 150%.

Rest periods should be calculated at the time the user indicates they are no
longer wearing the item.

The bottom pane will be a calendar view, showing the dates for previous,
current, and next weeks, upon which the user has or is able to wear an item,
and how long it was or can be worn for. Future iterations of wear should be
based upon *estimated* rest periods, which assume the user wears a 100%
difficulty item for the maximum permissible period. If the user is currently
wearing an item, it should be assumed they will stop at the instant they have
worn it for the maximum wear time.

There will be an items screen where the user can configure their items. Each
category of item has an associated icon and each item has an associated colour.
When displayed in the other views in the app, the item should always have its
associated icon and colour, and if reasonable, its title should be in the
associated colour. Item colours should be chosen from a set of colours
that contrast well with both white and black.

Each item has a difficulty multiplier, displayed as a %age, which is inversely
applied to all wear times and increments, such that, e.g. a 150% difficult item
is worn for 66% as long as a 100% difficulty item, but with the same rest
period durations.

If the user does not wear a given item category for over 24 hours following a
rest period, the additional "break time" should start to reduce the wear time
for the item, in a manner roughly mirroring the way the wear time increments.

There should be a goals & stats page which indicates progress towards users'
goals, and if they've met a goal the duration for how long they have been
achieving it for.

For each item category, statistics should be kept on the maximum ever wear
duration, the longest continuous streak without "break time", and the largest
total wear duration in a calendar month. Statistics on how many times and for
how long each invidual item was worn should be kept too, and a leaderboard per
category available.
