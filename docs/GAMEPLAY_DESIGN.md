# Gameplay design

## Controls (current)

| Action | Keyboard | Gamepad (standard mapping) | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrows | left stick (radial dead zone 0.18, rescaled) | joystick |
| Sprint (double-tap = knock-on) | Shift | RT | » |
| Pass · hold = lofted / cross · off the ball = standing tackle | J | A | ➤ |
| Shoot · hold = power + height · off the ball = slide / header | K | B | ⚽ |
| Finesse shot | I | X, or RB + B | — |
| Chip | O | LB + B | soft tap when the keeper is out |
| Through-ball · hold = lobbed | L | Y | — |
| Jockey / contain | C or Ctrl | LT | — |
| Switch player (stick direction = that way) | Space | LB / right-stick flick | ⇄ |
| Knock-on | double-tap Shift | right-stick flick on the ball | double-tap » |
| Camera mode | V | Back | — |
| Pause | Esc / P | Start | ⏸ |

Design rules: contextual buttons (four buttons play a match); the stick aims
(shot side, pass receiver, through-ball runner, first-touch direction); assists
only tidy results. Actions pressed up to ~0.55 s before the ball arrives are
buffered and played first-time.

## Assists (defaults, all in `match.*`)

- `assistReceive` — with the stick idle, the controlled player runs onto a pass or
  a loose ball next to him.
- `assistTackle` — the controlled player makes a standing tackle on his own when
  he reaches the ball facing it (manual J still works and can be better timed).
- Shot aim is clamped inside the posts by a margin that shrinks with the
  shooter's rating; execution error can still miss.
- Passes lead a moving receiver; weight is solved to arrive at 9.5 m/s (5 m/s for
  through-balls).

## Shooting

Charge 0–1 → speed (60–100 % of 31 m/s × shooting) and height (turf → just under
the bar, quadratic). Stick lateral = which side of the goal; idle = away from the
keeper. Finesse: 78 % pace, strong curl away from the keeper, lower error.
Chip: lob landing a metre short of the line. Airborne ball = volley (harder).

## Not built yet (see MASTER_PLAN)

Remapping UI and dead-zone setting UI, skill moves, shielding as an explicit
action, player-triggered runs, manual keeper control, practice arena, touch
buttons for through-ball/finesse, assist level settings in the menu.
