# Nebula Desktop

Nebula is a chat workspace where people and AI agents work together. The
desktop app has one window. The **Rail** on the left lists the Nebula DM,
Notifications, Tasks, the workspace's Channels, and its people. The rest of
the window is the **stage** for the room that is open: a Channel, the Nebula
DM, or a DM with a person. A Channel has a chat, and a side column with the
Call, People, and other boxes. **Settings** opens as a pane.

The app also has a second window, the **Capsule** (its URL ends in
`/capsule`). It is a small overlay that shows only while the app window is
away, so it is empty while the app window is open. Do not switch to it, and
do not report it as blank.

## Sign in

You start signed in. Bughunters gave the app a test session before it started.

- If you see the sign-in gate (`sign-in-gate`) with an email field, sign in
  failed. Report it as a critical bug, then finish.

## Onboarding

A new test identity sees two onboarding screens first. Complete them:

1. "Tell us who you are": type `Bughunters` as the first name and `Patrol` as the
   last name. If the screen asks for a username, type `bughunters-{{RUN_TAG}}`:
   each patrol has a new test identity, and a username must be unique. Then
   click Continue.
2. "Name your workspace": type `Bughunters Patrol` as the workspace name. Keep the
   slug that the app suggests. Then click the submit button.

You are in the app when you see the Rail and a Channel with a message composer.
Save the path through onboarding as the routine `enter-app`.

## What to explore

- Each Rail row: the Nebula DM, Notifications, Tasks, each Channel, and people.
- Settings and each of its sections.
- The "New channel" flow. You may create Channels whose names start with
  `bughunters-`.
- In a Channel that you created, you may send one short message, such as
  `Bughunters test message`. Look at how the message and the reply render.
- Menus, tabs, dialogs, and empty states.

## Never do these things

- Do not sign out.
- Do not delete the workspace or the account.
- Do not start, join, or ring a Call.
- Do not buy, upgrade, or open a billing checkout.
- Do not invite a person by email.
- Do not dispatch a long-running Task, and do not build a miniapp.
- Do not change the theme, the language, or any setting that stays after a
  restart, except in a Channel that you created.
