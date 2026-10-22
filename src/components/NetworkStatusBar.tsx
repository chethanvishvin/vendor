import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform,
} from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';

export const NetworkStatusBar: React.FC = () => {
  const netInfo = useNetInfo();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // A connection is online if connected and internet is not explicitly unreachable
  const isOnline = netInfo.isConnected === true && netInfo.isInternetReachable !== false;
  const isPending = netInfo.isConnected === null;

  const connectionType = (netInfo.type || 'unknown').toUpperCase();

  return (
    <View style={[styles.wrapper, isOnline ? styles.wrapperOnline : styles.wrapperOffline]}>
      <TouchableOpacity
        style={styles.container}
        onPress={() => setIsExpanded(prev => !prev)}
        activeOpacity={0.85}>
        <View style={styles.leftSection}>
          <View
            style={[
              styles.statusDot,
              isOnline ? styles.dotOnline : styles.dotOffline,
            ]}
          />
          <Text style={[styles.statusText, isOnline ? styles.textOnline : styles.textOffline]}>
            {isPending
              ? 'Checking Network...'
              : isOnline
                ? `ONLINE • ${connectionType === 'WIFI' ? 'Wi-Fi' : connectionType === 'CELLULAR' ? 'Mobile Data' : 'Connected'}`
                : 'OFFLINE MODE'}
          </Text>
        </View>

        <View style={styles.rightSection}>
          <View
            style={[
              styles.pillBadge,
              isOnline ? styles.pillOnline : styles.pillOffline,
            ]}>
            <Text
              style={[
                styles.pillBadgeText,
                isOnline ? styles.pillTextOnline : styles.pillTextOffline,
              ]}>
              {isOnline ? '☁️ Cloud Active' : '💾 SQLite Active'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      {/* Expanded details when offline or when user taps for details */}
      {(!isOnline || isExpanded) && (
        <View style={[styles.detailsBox, isOnline ? styles.detailsBoxOnline : styles.detailsBoxOffline]}>
          <Text style={[styles.detailsText, isOnline ? styles.detailsTextOnline : styles.detailsTextOffline]}>
            {isOnline
              ? 'Your device is connected to the internet. Station data and captured photos sync automatically.'
              : '⚡ No internet connection detected. You can still inspect substations, capture photos, and enter remarks — all work is saved instantly in the local SQLite database.'}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
    zIndex: 999,
  },
  wrapperOnline: {
    backgroundColor: '#F0FDF4',
    borderBottomColor: '#DCFCE7',
  },
  wrapperOffline: {
    backgroundColor: '#FEF2F2',
    borderBottomColor: '#FECACA',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  dotOnline: {
    backgroundColor: '#16A34A',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  dotOffline: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  textOnline: {
    color: '#15803D',
  },
  textOffline: {
    color: '#B91C1C',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pillBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  pillOnline: {
    backgroundColor: '#DCFCE7',
  },
  pillOffline: {
    backgroundColor: '#FEE2E2',
  },
  pillBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pillTextOnline: {
    color: '#166534',
  },
  pillTextOffline: {
    color: '#991B1B',
  },
  detailsBox: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 2,
  },
  detailsBoxOnline: {
    backgroundColor: '#F0FDF4',
  },
  detailsBoxOffline: {
    backgroundColor: '#FEF2F2',
  },
  detailsText: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  detailsTextOnline: {
    color: '#166534',
  },
  detailsTextOffline: {
    color: '#991B1B',
    fontWeight: '500',
  },
});
