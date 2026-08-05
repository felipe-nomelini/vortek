const { LogBox } = require("react-native");

if (__DEV__) {
  LogBox.ignoreLogs([
    "Can't perform a React state update on a component that hasn't mounted yet.",
  ]);
}

require("expo-router/entry");
