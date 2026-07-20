# WebDriverAgent (WDA) — what "configuring WDA" means for this project

WDA is the on-device XCUITest server that Appium's iOS driver talks to. Building it
requires Xcode + Apple signing, which is why it **cannot run on this Windows PC** —
and why nothing in this harness tries.

| Lane | WDA status |
|---|---|
| BrowserStack / LambdaTest (`npm run topgun:ios`) | **Vendor-managed.** The cloud builds, signs, installs, and recycles WDA per session. Our caps files intentionally set no WDA options. |
| Appetize (`npm run topgun:appetize`) | **No WDA at all** — Appetize drives the simulator through its own session API, not Appium. |
| Future local Mac | Appium auto-builds WDA on first XCUITest session (Xcode + signing team required; verify with `appium driver doctor xcuitest`). Relevant caps then: `appium:useNewWDA`, `appium:wdaLaunchTimeout`, `appium:webDriverAgentUrl`. Use `caps/generic.ios.json` + `APPIUM_REMOTE_URL=http://127.0.0.1:4723/`. |

**Definition of done for "WDA configured" here:** a cloud session starts and reaches the
lock screen (TC-IOS-001). If a session fails with a WDA-specific error, it's a vendor
ticket/capability tweak, not a local install task.

Deeper reference: top-gun plugin → `top-gun-ios/references/wda-and-inspector.md`.
