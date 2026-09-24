// Dynamic Expo config. app.json stays the one source of the app's config; this file returns it
// UNCHANGED for every build except a local-server one.
//
// The "simulator-local" EAS profile (eas.json) builds a Release app for the iOS Simulator that
// talks to a FamiliOS server on the same Mac over plain http://127.0.0.1:8787. iOS App Transport
// Security blocks plain http by default, so that build — and only that build — adds
// NSAllowsLocalNetworking, which permits http to loopback and .local hosts and nothing else.
// Production, preview and TestFlight builds point at https and get no ATS exception.
//
// Check: `npx expo config --type public` must print the same thing with and without this file
// unless EAS_BUILD_PROFILE=simulator-local (or EXPO_PUBLIC_API_URL is a loopback http URL).
// docs/verification/ios-simulator-mac.md walks through the local build.

function wantsLocalNetworking(env) {
  if (env.EAS_BUILD_PROFILE === "simulator-local") return true;
  const url = String(env.EXPO_PUBLIC_API_URL || "");
  return url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost");
}

module.exports = ({ config }) => {
  if (!wantsLocalNetworking(process.env)) return config;
  const ios = config.ios || {};
  return {
    ...config,
    ios: {
      ...ios,
      infoPlist: {
        ...(ios.infoPlist || {}),
        NSAppTransportSecurity: {
          ...((ios.infoPlist || {}).NSAppTransportSecurity || {}),
          NSAllowsLocalNetworking: true,
        },
      },
    },
  };
};
