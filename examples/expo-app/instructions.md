# Nebula Mobile

Nebula is a chat workspace where people and AI agents work together. The
mobile app opens on a Home launcher. From there the user reaches Channels, a
Channel's chatroom and its tabs, Tasks, agents, and settings.

## Sign in

The app starts logged out, on "Welcome to Nebula".

1. Do not type an email, and do not use Google or Apple sign-in. There is no
   code to type.
2. Open the link `{{E2E_LOGIN_LINK}}`. It installs a test session.
3. Wait until the Home launcher is visible.

- If the screen shows an element `e2e-login-error`, the session failed.
  Report it as a critical bug, then finish.

Save the path through sign in as the routine `enter-app`.

## Development builds

This is a development build. A red or yellow developer banner (for example
"LogBox" or "[RevenueCat] ...") at the bottom is not a product bug. Close it
with its X button. Do not report it, unless it covers a control that you need.

## What to explore

- The Home launcher and each item on it.
- The Channels list, a Channel's chatroom, and each of its tabs.
- Tasks, agents, the workspace switcher, and settings.
- Sheets, menus, and empty states.
- In a Channel, you may send one short message, such as `Bughunters test message`.

## Never do these things

- Do not sign out, and do not delete the account.
- Do not start or join a call.
- Do not buy anything or open a subscription screen's purchase button.
- Do not invite a person.
- Do not change a setting that stays after a restart.
