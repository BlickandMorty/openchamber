# OpenChamber Mobile

Capacitor shell for the dedicated OpenChamber mobile web surface.

The mobile package reuses the web build, then rewrites `mobile.html` to `index.html` in `packages/mobile/dist` so native iOS/Android always launch `MobileApp` instead of the hosted surface selector.

## Commands

- `bun run build` builds `packages/web` and prepares mobile web assets.
- `bun run sync` prepares assets and runs `cap sync`.
- `bun run add:ios` creates the native iOS project.
- `bun run add:android` creates the native Android project.
- `bun run build:android:debug` builds a debug Android APK without launching an emulator.
- `bun run build:ios:simulator` builds an iOS Simulator app without launching Xcode or Simulator.
- `bun run sim:run` boots a simulator if needed, installs the built iOS app, and launches it.
- `bun run sim:serve` starts `serve-sim` in detached JSON mode and prints the browser preview URL.
- `bun run sim:list` lists running `serve-sim` streams.
- `bun run sim:kill` stops running `serve-sim` streams.
- `bun run open:ios` opens the iOS project.
- `bun run open:android` opens the Android project.

## Local Tooling

The default scripts assume the local Homebrew/Xcode paths prepared for this workspace:

- Xcode: `/Applications/Xcode.app/Contents/Developer`
- JDK 21: `/opt/homebrew/opt/openjdk@21`
- Android SDK: `/opt/homebrew/share/android-commandlinetools`

Override `DEVELOPER_DIR`, `JAVA_HOME`, `ANDROID_HOME`, or `ANDROID_SDK_ROOT` when using a different local setup.
