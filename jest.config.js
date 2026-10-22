module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@react-native-community|@react-native-async-storage|react-native-image-picker|react-native-image-marker|react-native-geolocation-service)/)',
  ],
};
