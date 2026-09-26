# Acme Mobile

Acme is a team chat app. The mobile app opens on a Home screen. From there the
user reaches the channels, a channel's chat and its tabs, the inbox, and
settings.

## Sign in

The app starts signed out, on "Welcome to Acme".

1. Do not type an email, and do not use Google or Apple sign-in. There is no
   code to type.
2. Open the link `{{E2E_LOGIN_LINK}}`. It installs a test session.
3. Wait until the Home screen is visible.

- If the screen shows an element `e2e-login-error`, the session failed.
  Report it as a critical bug, then finish.

Save the path through sign in as the routine `enter-app`.

## Development builds

This is a development build. A red or yellow developer banner (for example
"LogBox") at the bottom is not a product bug. Close it with its X button. Do
not report it, unless it covers a control that you need.

## What to explore

- The Home screen and each item on it.
- The channels list, a channel's chat, and each of its tabs.
- The inbox, the workspace switcher, and settings.
- Sheets, menus, and empty states.
- In a channel, you may send one short message, such as `Bughunters test message`.

## Never do these things

- Do not sign out, and do not delete the account.
- Do not start or join a call.
- Do not buy anything, and do not push a purchase button.
- Do not invite a person.
- Do not change a setting that stays after a restart.
