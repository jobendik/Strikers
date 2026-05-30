# retention.md

# Universal Retention Model for Browser Games

## Purpose

This document defines a complete, reusable retention model that can work across almost any browser game genre: arcade, RTS, puzzle, platformer, shooter, idle, action, card, roguelite, or hybrid-casual. The model is designed for a CrazyGames-style environment where sessions are short, acquisition is volatile, players are impatient, and the game must create a strong reason to play one more round.

The model assumes:

- No real-money purchases.
- No real subscriptions.
- No real tracking beyond normal gameplay analytics.
- No real ads required for progress.
- No deceptive claims about real users, prices, scarcity, payments, or privacy.
- All rewards are earned in-game.

Because there is no real money involved, some patterns that would normally be dangerous in monetized games can be adapted safely as engagement mechanics. The important rule is this: use pressure to create excitement, not to deceive, shame, trap, or exploit. The system should make the player think, “I want one more match,” not “I am being manipulated and cannot leave.”

---

# 1. Core Philosophy

## The Retention Pyramid

Retention should be built in layers. Each layer answers one player question:

1. **Moment-to-moment:** Is it fun right now?
2. **Session:** Did this match produce visible progress?
3. **Return:** Is there a reason to come back tomorrow or later this week?
4. **Identity:** Do I feel like I am becoming better, richer, cooler, or more recognized?
5. **Collection:** Is there something I want to complete?
6. **Mastery:** Is there a long-term skill path?
7. **Social/competitive:** Do I have someone or something to compare myself against?
8. **Live-service:** Does the game feel alive without feeling like a chore?

The strongest retention system is not one mechanic. It is an overlapping set of small hooks that all point in the same direction.

The player should always have:

- Something to do now.
- Something almost completed.
- Something newly unlocked.
- Something improving over time.
- Something rare to chase.
- Something personal to show off.
- Something scheduled to return for.

---

# 2. The Universal Loop

Every match or run should follow this structure:

```text
Enter game → Short objective → Skill/action → Reward feedback → Result screen → Progress update → New goal → Replay prompt
```

The result screen is the retention engine. It should never be a dead end. It should show at least five forms of progress:

1. Match result: win/loss/survival/score.
2. XP gained.
3. Player level progress.
4. Daily/weekly objective progress.
5. Collection or season progress.
6. Achievement/medal progress.
7. Chest/reward progress.
8. Skill/stat improvement.

The goal is that even a failed round feels useful.

Example result screen:

```text
DEFEAT — Core destroyed at 07:42
+480 XP
Level 12 → 13: 82%
Daily Order: Destroy 3 Relays — 2/3
Season Track: 18/20 Signal Cores Damaged
Chest Progress: 94%
New Medal Progress: Comeback Victory — 4/5
Recommended Next Step: Play one more bot match to unlock chest
```

This is the most important retention principle: the player should leave every session with unfinished momentum.

---

# 3. Core Progression Systems

## 3.1 Player Level

A universal player level works in almost every game.

Purpose:

- Gives every match meaning.
- Creates long-term identity.
- Unlocks features gradually.
- Provides an easy reason to return.

Rules:

- Every completed match gives XP.
- Wins give more XP, but losses still give something.
- First match of the day gives a bonus.
- Good play gives bonus XP.
- XP should be visible immediately after the match.

Recommended structure:

```text
Level 1–5: very fast, one level per match
Level 6–15: one level every 2–3 matches
Level 16–30: one level every 4–6 matches
Level 31+: long-term prestige curve
```

Unlock examples:

- Level 2: Daily Orders
- Level 3: Cosmetic chest
- Level 5: Weekly Orders
- Level 8: Ranked/Bot ladder
- Level 10: Season Track
- Level 15: Collection Album
- Level 20: Prestige badges

## 3.2 Account Rank / Title

Alongside numerical level, use titles:

```text
Recruit → Operator → Specialist → Commander → Veteran → Elite → Mythic → Legend
```

Titles are emotionally stronger than numbers. They make progression feel like identity, not just math.

## 3.3 Mastery Levels

The game should not only level the account. It should level the things the player uses.

Examples by genre:

- RTS: squad mastery, relay mastery, core defense mastery.
- Shooter: weapon mastery, class mastery, map mastery.
- Platformer: character mastery, ability mastery, world mastery.
- Puzzle: mechanic mastery, difficulty mastery.
- Arcade: power-up mastery, enemy mastery, combo mastery.

Each mastery path should have:

- XP bar.
- Small rewards.
- Cosmetic badges.
- A visible “next mastery reward.”

Example:

```text
Assault Squad Mastery Level 4
Progress: 73%
Next reward: Blue muzzle flash effect
Task: Deal 3,000 damage with Assault Squad
```

---

# 4. The Post-Match Retention Screen

The post-match screen should be treated as the most important UI in the game.

## Required sections

### 1. Emotional result

Use a strong headline:

```text
VICTORY
DEFEAT
CORE SAVED
LAST SECOND COMEBACK
PERFECT DEFENSE
```

### 2. Score and performance

Show concrete stats:

- Score
- Time survived
- Damage dealt
- Objectives completed
- Accuracy / efficiency
- Enemies defeated
- Economy generated
- Best moment

### 3. Progress stack

Show multiple bars filling:

```text
Player Level: 82%
Season Track: 40%
Daily Order: 2/3
Chest: 94%
Achievement: 4/5
```

### 4. Reward reveal

Reveal rewards with satisfying timing:

- XP first.
- Currency second.
- Objective progress third.
- Chest/rare reward last.

### 5. Next best action

The player should always be told what to do next:

```text
One more match will unlock your chest.
Capture 1 more relay to complete Daily Order.
Win once on Hard Bot to unlock Commander Banner.
```

### 6. Replay button hierarchy

Primary button:

```text
PLAY AGAIN
```

Secondary buttons:

```text
UPGRADE
COLLECTION
MENU
```

Do not trap the user. The replay button can be attractive, but quitting must remain possible.

---

# 5. Daily Systems

## 5.1 Daily Login Bonus

Use this carefully. The daily login bonus should feel like a gift, not an obligation.

Recommended model:

- Player receives a small daily reward.
- Missing a day does not destroy everything.
- Weekly completion gives a larger bonus.
- Streaks can exist, but should be forgiving.

Structure:

```text
Day 1: 100 coins
Day 2: 150 coins
Day 3: Small chest
Day 4: 200 coins
Day 5: Cosmetic shard
Day 6: Medium chest
Day 7: Rare cosmetic chest
```

Safer version:

```text
Play any 3 days this week to claim the weekly bonus.
```

This is better than forcing seven consecutive days.

## 5.2 Daily Orders

Daily Orders are one of the strongest ethical retention tools.

Rules:

- 3 daily tasks.
- Complete in 5–15 minutes.
- Can be done in bot mode or casual mode.
- No task should require spending, watching ads, or inviting friends.
- Rewards should be useful but not mandatory.

Examples:

```text
Win 1 match
Destroy 3 relays
Deal 10,000 damage
Capture 5 objectives
Use 3 different units
Survive 4 waves
Earn a 5x combo
```

Daily Orders should be rerollable once per day.

## 5.3 Daily Chest Meter

Instead of giving a chest instantly for login, make the player earn it quickly.

Example:

```text
Daily Chest: 0/100 points
Complete match: +40
Win match: +30
Complete objective: +20
```

The meter should usually be completable in 2–3 matches.

This creates a strong “just one more” loop without deception.

---

# 6. Weekly Systems

Weekly systems are often better than daily systems because they are less stressful and more compatible with casual players.

## 6.1 Weekly Orders

Weekly Orders should be larger and more aspirational.

Examples:

```text
Win 5 matches
Complete 10 bot matches
Capture 50 objectives
Deal 250,000 total damage
Win with 3 different strategies
Defeat Hard Bot once
Earn 20 medals
```

Rewards:

- Large XP bonus.
- Rare chest.
- Profile banner.
- Cosmetic shard bundle.
- Season progress boost.

## 6.2 Weekly Event Rotation

Events make the game feel alive.

Example rotation:

```text
Monday: Double XP for first 3 matches
Tuesday: Bot Challenge Day
Wednesday: Relay Rush
Thursday: Cosmetic Shard Day
Friday: Weekend Warmup
Saturday: Big Event
Sunday: Weekly Finale
```

Avoid strict hour-only windows unless the event also repeats. Flexible windows are better.

## 6.3 Weekly Ladder

A weekly ladder can be used even without multiplayer.

Options:

- Score ladder.
- Bot challenge ladder.
- Speedrun ladder.
- Survival ladder.
- Objective ladder.
- Clan/team ladder.

To avoid toxicity, give rewards by participation tiers, not only top ranks.

Example:

```text
Top 50%: Small chest
Top 25%: Medium chest
Top 10%: Rare chest
Top 3%: Banner frame
Participation: XP bonus
```

---

# 7. Season System

A free Season Track is one of the most powerful cross-genre retention systems.

## 7.1 Free Season Track

The season track should be completely free if the game has no monetization.

Recommended structure:

- 30 levels for a small browser game.
- 50 levels for a larger game.
- 100 levels only if the game has deep content.
- Season length: 2–6 weeks.

Reward types:

- Coins.
- Cosmetic shards.
- Full cosmetics.
- Profile icons.
- Banners.
- Titles.
- Emotes.
- Trails.
- Skins.
- Victory effects.
- Sound stingers.

## 7.2 Dual Track Without Payment

You can still use the psychological effect of a premium track without real money by making it unlockable through gameplay.

Example:

```text
Free Track: unlocked by normal play
Elite Track: unlocked by completing 5 weekly orders
```

This preserves the motivational contrast without using money.

## 7.3 Retroactive Unlock

This is powerful and in the grey zone if monetized. In a free game, it can be used safely.

Example:

```text
You completed 5 Weekly Orders. Elite Track unlocked.
All previous Elite rewards are now claimable.
```

This feels amazing because progress was building in the background.

## 7.4 Season FOMO

Limited seasons work, but permanent loss can feel bad.

Recommended model:

- Season rewards are easiest to earn during the season.
- Old season cosmetics can return later through archive chests.
- Players are not told “never returns.”
- Use “season exclusive first release” instead of permanent lockout.

Good copy:

```text
Available during Signal Season 04. May return later in archive events.
```

Bad copy:

```text
Never returns. Last chance forever.
```

---

# 8. Collection System

Collection is a universal retention engine.

## 8.1 Collection Album

Create an album of unlockable items.

Categories:

- Skins.
- Colors.
- Trails.
- Victory effects.
- Avatars.
- Banners.
- Titles.
- Sound packs.
- Emotes.
- Unit variants.
- Weapon variants.
- Core effects.
- Map decorations.

Each item should show:

- Rarity.
- Source.
- Progress toward unlock.
- Equipped state.
- Preview.

## 8.2 Shards

Shards are extremely useful in free games.

Example:

```text
Blue Core Skin: 3/5 shards
Unlock after collecting 5 shards
Duplicates convert to universal shards
```

Benefits:

- Every reward can be useful.
- Duplicates do not feel terrible.
- Players can chase specific items.
- Progress is visible.

## 8.3 Collection Completion Bonuses

Reward completionists:

```text
Complete 5 blue cosmetics → Blue Commander title
Complete all common skins → Collector badge
Complete Season 04 set → Signal Archivist banner
```

Avoid inventory limits. They create frustration without improving the game.

---

# 9. Chest / Loot System

A random reward system can be acceptable when it is free, transparent, and not casino-like.

## 9.1 Free Chests

Chests should be earned through play:

- Daily chest.
- Weekly chest.
- Level-up chest.
- Achievement chest.
- Season chest.
- Event chest.
- Mastery chest.

## 9.2 Odds Disclosure

Even without money, show clear odds.

Example:

```text
Common: 70%
Rare: 22%
Epic: 7%
Mythic: 1%
```

## 9.3 Pity System

A pity system is useful if rare rewards exist.

Example:

```text
Epic guaranteed within 10 chests.
Mythic guaranteed within 50 chests.
```

This prevents frustration and gives visible long-term progress.

## 9.4 Avoid Near-Miss Manipulation

Do not show a wheel nearly landing on a mythic reward unless the wheel is a true representation of the outcome. Fake near-miss animations feel manipulative even if the chest is free.

Better reveal style:

- Chest opens.
- Rarity color builds.
- Item appears.
- Duplicate conversion shown clearly.

---

# 10. Currency System

Even without real money, currencies are useful for pacing.

## 10.1 Recommended Currency Types

Use no more than 3 currencies.

### Coins

Common currency.

Uses:

- Basic cosmetics.
- Rerolls.
- Minor upgrades.
- Shop rotation.

### Gems / Crystals

Rare earned currency.

Uses:

- Special cosmetics.
- Event items.
- Chest crafting.
- Season archive items.

### Shards

Collection-specific progress currency.

Uses:

- Unlock specific cosmetics.
- Duplicate compensation.
- Crafting.

Avoid excessive currency complexity. It can be engaging, but too many currencies make the game feel like a manipulative mobile shop.

## 10.2 One-Way Wallet Without Money

A one-way currency system is not financially harmful if there is no real money, but leftover currency still creates a return hook.

Use it like this:

```text
Player has 80 crystals.
Desired skin costs 100 crystals.
Next weekly order gives 25 crystals.
```

This creates a clean goal.

## 10.3 Shop Rotation

A rotating free shop is effective.

Rules:

- Items cost earned currency only.
- Rotation every 24h or 48h.
- Items return later.
- Player can wishlist items.
- No false “only 3 left.”

Good copy:

```text
Rotates in 18h. This item can return later.
```

---

# 11. Event System

Events are essential for making a small game feel alive.

## 11.1 Event Types

### Time-limited modifiers

```text
Double XP Weekend
Relay Rush
Fast Economy Mode
One-Life Challenge
Tiny Map Mayhem
Boss Core Event
```

### Challenge events

```text
Win 3 matches with limited units
Survive 10 waves
Capture objectives without losing a unit
```

### Collection events

```text
Earn 10 Neon Shards
Unlock seasonal skin fragments
Complete event album
```

### Community events

If real global data exists:

```text
Community Goal: Destroy 1,000,000 enemy cores
```

If not, do not fake it as real. Use fictional/lore framing instead:

```text
Simulation Goal: Stabilize 1,000,000 signal nodes
```

## 11.2 Event Calendar

Give players predictability.

Example:

```text
This Week
Mon–Tue: Relay Rush
Wed–Thu: Double Mastery XP
Fri–Sun: Signal Storm Event
```

## 11.3 Flexible Scarcity

Use urgency, but avoid lies.

Acceptable:

```text
Event ends in 2d 4h.
```

Grey-zone but acceptable if true:

```text
Only 2 days left to earn this reward during the event.
```

Avoid:

```text
Never returns.
Only 3 left.
Sarah just claimed the last one.
```

---

# 12. Streaks and Habit Loops

Streaks are powerful but risky.

## 12.1 Safer Streak Model

Instead of “consecutive days or lose everything,” use weekly activity.

```text
Play 3 days this week to complete Weekly Streak.
```

This creates return behavior without punishment.

## 12.2 Forgiving Streaks

If using daily streaks:

- Missing one day should not reset everything immediately.
- Give automatic grace once per week.
- Rewards already earned are never removed.
- Do not use guilt copy.

Good copy:

```text
Your streak is paused. Play today to continue toward the weekly bonus.
```

Bad copy:

```text
You are about to lose everything.
```

## 12.3 Streak Rewards

Use escalating rewards but not too extreme.

```text
Day 1: Coins
Day 2: Coins
Day 3: Small chest
Day 4: Shards
Day 5: Medium chest
Day 6: Cosmetic fragment
Day 7: Rare chest
```

---

# 13. Quest System

## 13.1 Quest Types

Use several quest layers:

### Daily Orders

Short tasks completed quickly.

### Weekly Orders

Medium tasks completed over several sessions.

### Seasonal Missions

Long tasks across weeks.

### Mastery Missions

Skill-based tasks tied to specific mechanics.

### Hidden Achievements

Surprise rewards for unusual actions.

## 13.2 Quest Design Rules

Good quests:

- Encourage varied play.
- Teach mechanics.
- Reward skill.
- Fit natural gameplay.
- Can be completed without frustration.

Bad quests:

- Force boring repetition.
- Require social spam.
- Require specific rare events.
- Block progress.
- Demand daily compulsion.

## 13.3 Quest Rerolls

Allow rerolling one daily quest per day.

This reduces frustration and gives the player agency.

---

# 14. Achievement and Medal System

Achievements provide long-term retention. Medals provide short-term dopamine.

## 14.1 Medals

Medals happen during or after a match.

Examples:

```text
First Blood
Perfect Defense
Relay Breaker
Core Savior
Comeback
Flawless Victory
Economy Master
Last Second Win
No Units Lost
High Efficiency
```

Medals should produce:

- Sound.
- Animation.
- XP bonus.
- Collection progress.
- Result screen highlight.

## 14.2 Achievements

Achievements are long-term.

Examples:

```text
Win 100 matches
Capture 1,000 objectives
Defeat Hard Bot 10 times
Complete a season track
Unlock 50 cosmetics
Win with every strategy
```

Achievement rewards:

- Title.
- Badge.
- Banner.
- Cosmetic.
- Chest.

## 14.3 Progress Visibility

Always show partial progress.

```text
Comeback King: 4/5 comeback wins
Relay Specialist: 28/50 relays captured
```

Partial achievement progress is a strong return hook.

---

# 15. Difficulty Ladder

A difficulty ladder works across almost every genre.

## 15.1 Bot/Challenge Ladder

Example:

```text
Training
Easy
Normal
Hard
Expert
Nightmare
Impossible
```

Each tier should unlock:

- Higher XP multiplier.
- Unique medal.
- Cosmetic reward.
- Leaderboard category.

## 15.2 Challenge Modifiers

Modifiers create variety without building entirely new content.

Examples:

```text
Double enemy speed
Low health start
No healing
Small map
Random units
Fog of war
Sudden death
One-life mode
```

## 15.3 Skill-Based Retention

The player should feel they are improving, not just grinding.

Show stats:

- Better survival time.
- Higher accuracy.
- Better economy.
- Fewer mistakes.
- Faster completion.
- Higher score.

---

# 16. Social and Competitive Systems

Social pressure is powerful and dangerous. Use it carefully.

## 16.1 Leaderboards

Leaderboards are effective if fair.

Types:

- Daily score.
- Weekly score.
- Friends.
- Regional.
- Bot challenge.
- Speedrun.
- Survival.
- Ranked.

Reward participation as well as top performance.

## 16.2 Ghost Competitors / AI Rivals

If you do not have real social data, use AI rivals but label them honestly.

Good:

```text
AI Rival: Commander Vega beat your time by 12s.
```

Bad:

```text
Sarah from your area just beat you.
```

## 16.3 Social Comparison

Comparison motivates players but can create shame.

Use comparison like this:

```text
Your best score: 48,200
Global average: 31,400
Your rank: Top 28%
```

Avoid:

```text
Your friends are far ahead. Catch up now.
```

## 16.4 Team/Clan Goals

If the game has no real clans, use faction goals or lore goals.

Example:

```text
Blue Faction Weekly Goal: Capture 500,000 relays
```

This should be based on real aggregate data if presented as real. If simulated, clearly frame it as fiction or event progress.

---

# 17. Notification and UI Pressure System

In browser games, in-game notifications are more important than external push notifications.

## 17.1 Toasts

Use non-blocking toasts for:

- Daily ready.
- Quest progress.
- Chest unlocked.
- Event started.
- Achievement near completion.
- Friend/rival beat score.
- Season progress.

Toasts should not block gameplay.

## 17.2 Badges

Badges are strong. Use them honestly.

Good badge triggers:

- Claimable reward.
- New cosmetic.
- Completed quest.
- New event.
- New achievement.

Avoid badge inflation for meaningless updates.

## 17.3 Modal Cadence

Blocking modals should be rare.

Recommended rules:

- No blocking modal during active gameplay.
- No more than one promotional/retention modal per session.
- Result screen can contain retention prompts, but should not trap the player.
- Player-initiated menus can show deeper systems.

Use overlays only for:

- Level up.
- Major unlock.
- Season intro.
- First-time onboarding.
- Important consent/settings.

## 17.4 Grey-Zone Visual Hierarchy

You can make the desired action visually strong:

```text
PLAY AGAIN — bright primary button
MENU — smaller secondary button
```

This is acceptable if the alternative remains clear and honest.

Do not make decline buttons hidden, fake-disabled, tiny, or misleading.

---

# 18. Scarcity and Urgency

Scarcity is effective but must be true.

## 18.1 Ethical Scarcity

Use:

- Event end timers.
- Daily rotation timers.
- Weekly reset timers.
- Season countdowns.
- Limited challenge windows.

Do not use:

- Fake stock.
- Fake users buying items.
- Resetting countdowns presented as real.
- “Never returns” unless genuinely true and fair.

## 18.2 Soft Urgency Copy

Good:

```text
Event ends in 2 days.
Complete 2 more missions to claim the banner.
```

Grey-zone but usable:

```text
Almost there — one more win unlocks the chest.
```

Avoid:

```text
Leave now and lose everything.
```

## 18.3 Rotating Shop

A rotating shop creates urgency without deception.

Rules:

- Items rotate on a real timer.
- Items can return later.
- Wishlist alerts can show when an item returns.
- No fake stock numbers.

---

# 19. Energy and Artificial Waiting

Traditional energy systems are risky because they stop players from playing. On CrazyGames, stopping play is usually bad.

## 19.1 Do Not Gate Core Play

Never prevent a player from playing because energy is empty.

Bad:

```text
No energy. Wait 20 minutes.
```

## 19.2 Use Energy as Bonus Charge

Better:

```text
Core Charge: 100%
While charged, earn +25% XP.
After 3 matches, charge depletes.
Keep playing normally, or return later for bonus charge.
```

This creates return motivation without blocking.

## 19.3 Artificial Waiting as Anticipation

Waiting can work if it creates anticipation, not obstruction.

Examples:

- Chest unlocks after match countdown, but player can keep playing.
- Crafting cosmetic completes after 10 minutes, but gameplay continues.
- Event starts later, but other modes remain open.

Never make “pay to skip” because there is no money. If using skip, make it earned:

```text
Use 1 Skip Ticket earned from weekly orders.
```

---

# 20. Onboarding Retention

The first 5 minutes decide everything.

## 20.1 First Session Goals

The player should experience:

1. Immediate gameplay within 10 seconds.
2. First reward within 30 seconds.
3. First level-up within 2 minutes.
4. First chest within 5 minutes.
5. First visible long-term goal before leaving.

## 20.2 First Session Flow

```text
Start → Tutorial objective → First win/loss → XP bar fills → Level up → Chest → Daily Orders unlocked → Play Again prompt
```

## 20.3 First-Time Bonuses

Use strong early rewards:

- First match bonus.
- First win chest.
- First level-up skin.
- Beginner track.

Since there is no money, beginner generosity is not manipulative. It helps the player understand the reward economy.

---

# 21. Comeback and Loss Retention

A loss should never feel like wasted time.

## 21.1 Loss Rewards

After defeat, show:

- XP earned.
- What improved.
- What was nearly completed.
- Suggested next strategy.
- Easier replay option.

Example:

```text
Defeat — but you destroyed 2/3 relays.
Daily Order almost complete.
Try one more bot match to claim chest.
```

## 21.2 Comeback Hooks

Comebacks create memorable stories.

Reward:

- Winning after low health.
- Surviving last second.
- Recovering after losing objective.
- Defeating stronger bot.

Give these medals dramatic presentation.

## 21.3 Adaptive Difficulty

If a player loses repeatedly:

- Offer strategy tip.
- Suggest easier mode.
- Give pity chest progress.
- Match with weaker bot.
- Unlock a helpful tool.

Do not shame the player.

---

# 22. Exit and Pause Retention

Exit friction is a dark pattern when it traps the player. But a clean “progress saved” exit can increase trust and future return.

## 22.1 Pause Menu

Pause menu should show:

- Current objective.
- Current progress.
- Claimable rewards if any.
- Resume button.
- Restart button.
- Quit button.

Recommended hierarchy:

```text
RESUME — primary
RESTART — secondary
QUIT TO MENU — secondary
```

## 22.2 Exit Message

Use neutral retention copy.

Good:

```text
Progress saved. Come back anytime.
Daily chest is 80% complete.
```

Grey-zone but acceptable:

```text
You are close to unlocking a chest. Quit anyway?
```

Avoid:

```text
Do not abandon your progress.
You will regret leaving.
Your streak will die.
```

## 22.3 Return Reminder Inside Game

Instead of guilt, use planning:

```text
Next reward available tomorrow.
Weekly event continues for 3 days.
```

---

# 23. Grey-Zone Adaptations

This section converts dark-pattern-like mechanics into acceptable engagement mechanics for a free game.

## 23.1 Premium Currency Obfuscation → Earned Multi-Currency Goals

Use multiple currencies only if each has a clear gameplay purpose.

```text
Coins = common cosmetics
Crystals = rare cosmetics
Shards = specific collection progress
```

Do not make values intentionally confusing.

## 23.2 Battle Pass Premium Track → Earned Elite Track

Use an “Elite Track” unlocked through weekly performance, not payment.

## 23.3 Energy Gate → Bonus Energy

Energy should boost rewards, never block play.

## 23.4 Loot Box → Free Reward Chest

Chests should be earned, odds visible, and duplicates compensated.

## 23.5 Fake Social Proof → Lore/AI Activity Feed

If activity is simulated, label it as simulation or lore.

```text
Simulation Feed: AI Commander Vega completed Relay Rush.
```

## 23.6 Scarcity → Real Event Timer

Use real timers and honest rotations.

## 23.7 Exit Friction → Progress Summary

Show what is saved and what is close, but allow leaving.

## 23.8 Confirmshaming → Respectful CTA Copy

Use strong positive CTAs, but neutral refusal.

## 23.9 Modal Stacking → Layered Non-Blocking Nudges

Replace blocking modals with:

- Toasts.
- Badges.
- Result screen panels.
- Menu cards.
- Progress bars.

## 23.10 Forced Continuity → Voluntary Return Track

No subscriptions. Instead:

```text
Return 3 times this week to complete the activity track.
```

---

# 24. Systems to Avoid Completely

Even without money, some patterns should not be used because they damage trust.

Avoid:

- Fake close buttons.
- Fake real-user activity.
- Fake scarcity.
- Misleading disabled buttons.
- Bait-and-switch buttons.
- Hidden terms.
- Trick wording.
- Shame-based refusal copy.
- Obstructive quit flow.
- Fake countdowns that reset.
- Vulnerability targeting.
- Dark A/B testing that optimizes compulsion at the cost of wellbeing.

These systems may increase short-term clicks, but they make the product feel cheap, scammy, or hostile.

---

# 25. The Universal Retention Architecture

## 25.1 Data Model

Recommended persistent player data:

```json
{
  "playerId": "local-or-platform-id",
  "level": 12,
  "xp": 8420,
  "coins": 1280,
  "crystals": 45,
  "lastPlayedDate": "2026-05-26",
  "weeklyActivityDays": ["Mon", "Wed"],
  "dailyOrders": [],
  "weeklyOrders": [],
  "season": {
    "id": "signal_season_04",
    "xp": 18400,
    "level": 18,
    "eliteUnlocked": false
  },
  "collection": {
    "owned": [],
    "shards": {}
  },
  "achievements": {},
  "mastery": {},
  "stats": {},
  "settings": {
    "reducedMotion": false,
    "notificationIntensity": "normal"
  }
}
```

## 25.2 Match Reward Pipeline

```text
Match ends
→ Calculate base rewards
→ Apply performance bonuses
→ Apply first-win/daily/weekly modifiers
→ Update XP
→ Update season
→ Update quests
→ Update achievements
→ Update mastery
→ Update collection/chest progress
→ Generate result screen cards
→ Recommend next action
```

## 25.3 Reward Priority

Rewards should be shown in this order:

1. Match result.
2. XP and level.
3. Quest progress.
4. Season progress.
5. Chest progress.
6. Collection unlock.
7. Achievement/medal.
8. Next action.

---

# 26. Recommended Feature Set by Development Phase

## Phase 1 — Minimum Viable Retention

Implement first:

- XP and player level.
- Result screen with progress bars.
- Daily Orders.
- Weekly Orders.
- Basic achievements.
- Chest progress meter.
- Cosmetic collection.
- Toasts and medals.

This alone can dramatically improve retention.

## Phase 2 — Strong Retention

Add:

- Free Season Track.
- Mastery levels.
- Weekly event rotation.
- Difficulty ladder.
- Collection shards.
- Weekly leaderboard.
- First-win bonus.
- Return bonus.

## Phase 3 — Advanced Retention

Add:

- Earned Elite Track.
- Archive shop.
- AI rivals.
- Faction events.
- Dynamic recommended goals.
- Personalized next-action cards.
- Pity system.
- Cosmetic crafting.

## Phase 4 — Live-Service Layer

Add:

- Monthly seasons.
- Rotating challenge modes.
- Community/lore events.
- Prestige system.
- Long-term collection albums.
- Tournament weekends.

---

# 27. Metrics

Track retention ethically.

## Core metrics

- D1 retention.
- D7 retention.
- D30 retention.
- Average session length.
- Matches per session.
- Replay rate after first match.
- Replay rate after defeat.
- Daily Order completion rate.
- Weekly Order completion rate.
- Season level distribution.
- Chest claim rate.
- Achievement unlock rate.
- Return after event participation.

## Quality metrics

Also track:

- Quit after modal.
- Quit after loss.
- Time to first fun moment.
- Tutorial drop-off.
- Rage quit signals.
- Settings changed to reduce effects.
- Repeated failed attempts.

Do not only optimize for more time spent. Optimize for satisfying return.

---

# 28. Anti-Addiction Guardrails

The goal is strong engagement, not harmful compulsion.

Use these guardrails:

- No real-money pressure.
- No deceptive social proof.
- No fake scarcity.
- No blocking gameplay with sales-style modals.
- No punishment for leaving.
- No loss of earned rewards for missing days.
- No external push spam.
- No targeting based on vulnerability.
- Clear settings for reduced motion/effects.
- Clear exit and pause options.
- Rewards should make play feel meaningful, not mandatory.

A good retention system respects the player enough that they want to return voluntarily.

---

# 29. Concrete Universal Example

This example can be adapted to almost any game.

## First session

```text
Player starts game.
Completes first 2-minute match.
Receives +300 XP.
Levels from 1 to 2.
Unlocks Daily Orders.
Gets Beginner Chest.
Receives 1 cosmetic shard.
Result screen says: “One more match unlocks your first full cosmetic.”
```

## Second session

```text
Player returns later.
Daily Bonus appears.
Daily Orders show 0/3.
Player completes 2 matches.
Daily Chest reaches 100%.
Weekly Activity reaches 2/3 days.
Season Track reaches Level 3.
```

## One-week loop

```text
Player plays 3 days.
Completes Weekly Activity.
Claims Rare Chest.
Unlocks Elite Track for this week.
Receives retroactive Elite rewards.
Sees next week’s event preview.
```

## Long-term loop

```text
Player wants to complete Season 04 collection.
Needs 3 more shards for Mythic Core Trail.
Weekly event offers those shards.
Player returns for event.
During event, unlocks mastery reward.
Mastery reward creates a new goal.
```

---

# 30. Recommended Default Retention Model

For most CrazyGames-style games, use this exact package:

1. **Account XP and Levels**
2. **Post-Match Progress Screen**
3. **Daily Orders**
4. **Weekly Orders**
5. **Weekly Activity Meter**
6. **Free Season Track**
7. **Earned Elite Track**
8. **Cosmetic Collection Album**
9. **Shard-Based Unlocks**
10. **Free Chests With Visible Odds**
11. **Pity Progress for Rare Rewards**
12. **Achievements**
13. **In-Match Medals**
14. **Mastery Levels**
15. **Difficulty Ladder**
16. **Rotating Events**
17. **Rotating Earned-Currency Shop**
18. **Toasts and Badges**
19. **Replay-Oriented Result Screen**
20. **Clean Exit With Progress Saved**

This combination is strong enough to make players return without needing real money, ads, subscriptions, or deception.

---

# 31. Final Design Principle

The best retention model is not built around trapping the player. It is built around unfinished desire.

A player should always feel:

```text
I improved.
I earned something.
I almost unlocked something.
I discovered a new goal.
I want to try one more time.
```

That is the ethical version of the same psychological machinery used in darker systems. It keeps the motivational power, but removes deception, financial harm, shame, and obstruction.

