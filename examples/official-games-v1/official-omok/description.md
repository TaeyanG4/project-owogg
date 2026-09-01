# Omok — Five in a Row

OWOGG Omok is a two-player strategy board game on a 15×15 grid. Play locally by taking turns on one device, or choose online multiplayer when the OWOGG relay service is available. The goal is to form a winning horizontal, vertical, or diagonal line before your opponent.

## How to play

1. Black places the first stone, then Black and White alternate turns.
2. Select an empty intersection to place one stone.
3. Build your own line while blocking your opponent's threats.
4. Start a new local game or request an online rematch after a round ends.

## Rules used in this game

This version uses a free opening with Renju-style forbidden moves for Black. Black wins with exactly five connected stones, but an overline, double-three, or double-four is forbidden. White wins by connecting five or more stones. A forbidden Black placement is rejected before it changes the board.

## Local and online modes

Local multiplayer is played by two people sharing the same screen. Online multiplayer uses OWOGG's relay protocol, with the room host maintaining the authoritative game state and reconnect support available for interrupted sessions. Online play may be unavailable during maintenance; local play remains structurally separate.

## Frequently asked questions

### Does Omok have a leaderboard?

No. This version records the match outcome inside the room but does not publish a score leaderboard.

### How many players are required?

Exactly two players are required for both local and online matches.
