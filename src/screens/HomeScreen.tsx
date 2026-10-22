import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
  ToastAndroid,
  Platform,
} from 'react-native';
import { apiService } from '../api/apiService';
import {
  VendorProfile,
  StationItem,
  AssignmentItem,
  FetchVendorDetailResult,
  CompletedStationItem,
  DashboardCountData,
} from '../types';
import { StationDetailScreen } from './StationDetailScreen';
import { OfflineQueueScreen } from './OfflineQueueScreen';
import { CompletedStationCard } from '../components/CompletedStationCard';
import NetInfo from '@react-native-community/netinfo';
import {
  syncPendingStationsToSQLite,
  getPendingStationsFromSQLite,
  getLastSyncMetadata,
  getOfflineSubmissionsCount,
  addOfflineQueueListener,
  syncAllOfflineSubmissions,
} from '../db/sqliteService';

interface HomeScreenProps {
  currentVendor: VendorProfile;
  onLogout: () => void;
  isJustLoggedIn?: boolean;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  currentVendor,
  onLogout,
  isJustLoggedIn,
}) => {
  const [selectedVendorId] = useState<number>(currentVendor.VendorId);
  const [dataResult, setDataResult] = useState<FetchVendorDetailResult | null>(null);
  const [completedStations, setCompletedStations] = useState<CompletedStationItem[]>([]);
  const [dashboardCounts, setDashboardCounts] = useState<DashboardCountData | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Independent fetch for dashboard metrics counts
  const fetchDashboardCounts = async (vendorId: number) => {
    try {
      const res = await apiService.fetchDashboardCount(vendorId, 2);
      if (res && res.status && res.data) {
        setDashboardCounts(res.data);
      }
    } catch (err: any) {
      console.warn('Independent dashboard count fetch failed:', err.message);
    }
  };


  // Search and Filter states
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedVoltage, setSelectedVoltage] = useState<string>('ALL');

  // Station selection state for full screen detail view
  const [selectedStation, setSelectedStation] = useState<StationItem | CompletedStationItem | null>(null);

  // SQLite Sync State
  const [syncState, setSyncState] = useState<{
    status: 'idle' | 'syncing' | 'completed' | 'error';
    count: number;
    lastSyncedAt?: number;
    message?: string;
  }>({
    status: 'idle',
    count: 0,
  });
  const [showSyncBanner, setShowSyncBanner] = useState<boolean>(false);
  const syncTimerRef = useRef<any>(null);

  // Offline queue state
  const [showOfflineQueue, setShowOfflineQueue] = useState<boolean>(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(0);

  const refreshQueueCount = useCallback(async () => {
    try {
      const count = await getOfflineSubmissionsCount(selectedVendorId);
      setOfflineQueueCount(count);
    } catch (_) {}
  }, [selectedVendorId]);

  useEffect(() => {
    // Read last sync info on initial load
    getLastSyncMetadata().then(meta => {
      if (meta && meta.count > 0) {
        setSyncState(prev => ({
          ...prev,
          count: meta.count,
          lastSyncedAt: meta.timestamp,
        }));
      }
    });

    // Subscribe to reactive offline queue changes in SQLite
    const unsubQueue = addOfflineQueueListener(count => {
      setOfflineQueueCount(count);
      // Whenever queue count changes (e.g. submissions synced and flushed):
      // refresh pending and completed station data in background
      fetchAllData(selectedVendorId, false);
      fetchDashboardCounts(selectedVendorId);
    });

    return () => {
      unsubQueue();
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [selectedVendorId]);

  const startBackgroundSQLiteSync = (vendorId: number, stations: StationItem[]) => {
    setSyncState(prev => ({
      ...prev,
      status: 'syncing',
      message: `Syncing pending stations to SQLite...`,
    }));
    setShowSyncBanner(true);

    // Run asynchronously in background after UI renders without freezing
    setTimeout(async () => {
      try {
        const syncRes = await syncPendingStationsToSQLite(vendorId, stations);

        // Also check and trigger offline submissions sync if device has internet
        try {
          const netState = await NetInfo.fetch();
          if (netState.isConnected && netState.isInternetReachable !== false) {
            await syncAllOfflineSubmissions(vendorId);
          }
        } catch (_) {}
        await refreshQueueCount();

        if (syncRes.success) {
          const now = Date.now();
          setSyncState({
            status: 'completed',
            count: syncRes.count,
            lastSyncedAt: now,
            message: `Synced completed! ${syncRes.count} pending stations stored in local SQLite database.`,
          });
          setShowSyncBanner(true);

          if (Platform.OS === 'android') {
            ToastAndroid.show(
              `✅ Synced completed: ${syncRes.count} pending stations stored in SQLite database`,
              ToastAndroid.LONG,
            );
          }

          if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
          syncTimerRef.current = setTimeout(() => {
            setShowSyncBanner(false);
          }, 5000);
        } else {
          setSyncState(prev => ({
            ...prev,
            status: 'error',
            message: syncRes.error || 'Failed to sync with local database',
          }));
        }
      } catch (err: any) {
        setSyncState(prev => ({
          ...prev,
          status: 'error',
          message: err?.message || 'Database sync error',
        }));
      }
    }, 150);
  };

  const fetchAllData = async (vendorId: number, showLoading = true) => {
    if (showLoading) setIsLoading(true);
    setErrorMessage(null);

    try {
      const [assignedRes, completedRes] = await Promise.allSettled([
        apiService.fetchVendorWiseDetail(vendorId, 2),
        apiService.fetchCompletedStations(vendorId, 2),
      ]);

      let hasData = false;

      if (assignedRes.status === 'fulfilled' && assignedRes.value?.status) {
        setDataResult(assignedRes.value.result);
        if (assignedRes.value.result.assignments?.length > 0) {
          hasData = true;

          // Extract all pending stations across assignments and sync to SQLite
          const pendingList: StationItem[] = [];
          assignedRes.value.result.assignments.forEach((assignment: AssignmentItem) => {
            if (assignment.stations && Array.isArray(assignment.stations)) {
              pendingList.push(...assignment.stations);
            }
          });

          if (pendingList.length > 0) {
            startBackgroundSQLiteSync(vendorId, pendingList);
          }
        }
      }

      let fetchedCompleted: CompletedStationItem[] = [];
      if (completedRes.status === 'fulfilled' && completedRes.value?.status) {
        fetchedCompleted = completedRes.value.data || [];
        setCompletedStations(fetchedCompleted);
        if (fetchedCompleted.length > 0) {
          hasData = true;
        }
      }

      // If this vendor has completed stations but 0 assigned stations, auto-switch to completed tab
      const assignedCount =
        assignedRes.status === 'fulfilled' && assignedRes.value?.result?.assignments
          ? assignedRes.value.result.assignments.reduce(
            (acc, a) => acc + (a.stations?.length || 0),
            0,
          )
          : 0;

      if (assignedCount === 0 && fetchedCompleted.length > 0) {
        setActiveTab('completed');
      }

      if (
        !hasData &&
        assignedRes.status === 'rejected' &&
        completedRes.status === 'rejected'
      ) {
        // Fallback: load pending stations from local SQLite database
        const localPending = await getPendingStationsFromSQLite(vendorId);
        if (localPending.length > 0) {
          hasData = true;
          setDataResult({
            assignments: [
              {
                VendorAssignmentId: 0,
                stations: localPending,
              } as any,
            ],
          } as any);
          setSyncState(prev => ({
            ...prev,
            status: 'idle',
            count: localPending.length,
            message: `Loaded ${localPending.length} pending stations from SQLite database (Offline mode).`,
          }));
          if (Platform.OS === 'android') {
            ToastAndroid.show(
              `📁 Offline: Loaded ${localPending.length} stations from SQLite`,
              ToastAndroid.SHORT,
            );
          }
        } else {
          setErrorMessage('Failed to connect to RNA service. Please check network.');
        }
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to fetch vendor assignments from RNA service.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboardCounts(selectedVendorId);
    fetchAllData(selectedVendorId);
    refreshQueueCount();
  }, [selectedVendorId, refreshQueueCount]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchDashboardCounts(selectedVendorId);
    fetchAllData(selectedVendorId, false);
    refreshQueueCount();
  };


  const handleConfirmLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to end your vendor session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: onLogout,
      },
    ]);
  };

  // Collect all assigned stations across assignments
  const allAssignedStations = useMemo(() => {
    if (!dataResult?.assignments) return [];
    const list: StationItem[] = [];
    dataResult.assignments.forEach((assignment: AssignmentItem) => {
      if (assignment.stations && Array.isArray(assignment.stations)) {
        list.push(...assignment.stations);
      }
    });
    return list;
  }, [dataResult]);

  // Aggregate stats
  const stats = useMemo(() => {
    let assignedTotal = 0;
    let pendingCount = 0;

    if (dataResult?.assignments && dataResult.assignments.length > 0) {
      dataResult.assignments.forEach(a => {
        assignedTotal += a.stationCount || a.stations?.length || 0;
        pendingCount += a.pendingStationCount || 0;
      });
    } else {
      assignedTotal = allAssignedStations.length;
      pendingCount = allAssignedStations.filter(s => s.StatusId !== 3).length;
    }

    const completedCount = completedStations.length;
    const total = Math.max(assignedTotal, completedCount + pendingCount);

    return { total, completed: completedCount, pending: pendingCount };
  }, [dataResult, allAssignedStations, completedStations]);

  // Available voltage filters (including standard 66, 110, 220, 400 kV)
  const voltageOptions = useMemo(() => {
    const set = new Set<string>(['66', '110', '220', '400']);
    allAssignedStations.forEach(s => s.VoltageClass && set.add(s.VoltageClass));
    completedStations.forEach(s => s.VoltageClass && set.add(s.VoltageClass));
    const sorted = Array.from(set).sort((a, b) => Number(a) - Number(b));
    return ['ALL', ...sorted];
  }, [allAssignedStations, completedStations]);


  // Filtered assigned station list
  const filteredAssignedStations = useMemo(() => {
    return allAssignedStations.filter(station => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        station.Station?.toLowerCase().includes(q) ||
        station.Taluk?.toLowerCase().includes(q) ||
        station.InChangreAEJEname?.toLowerCase().includes(q) ||
        station.SwitchSerialNumber?.toLowerCase().includes(q) ||
        station.ResilientSerialNumber?.toLowerCase().includes(q);

      const matchesVoltage =
        selectedVoltage === 'ALL' || station.VoltageClass === selectedVoltage;

      return matchesSearch && matchesVoltage;
    });
  }, [allAssignedStations, searchQuery, selectedVoltage]);

  // Filtered completed station list
  const filteredCompletedStations = useMemo(() => {
    return completedStations.filter(station => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        station.Station?.toLowerCase().includes(q) ||
        station.Taluk?.toLowerCase().includes(q) ||
        station.Division?.toLowerCase().includes(q) ||
        station.InChangreAEJEname?.toLowerCase().includes(q) ||
        station.SwitchSerialNumber?.toLowerCase().includes(q) ||
        station.ResilientSerialNumber?.toLowerCase().includes(q) ||
        station.InstallationCreatedByUserName?.toLowerCase().includes(q);

      const matchesVoltage =
        selectedVoltage === 'ALL' || station.VoltageClass === selectedVoltage;

      return matchesSearch && matchesVoltage;
    });
  }, [completedStations, searchQuery, selectedVoltage]);

  const jurisdiction = useMemo(() => {
    const assignment = dataResult?.assignments?.[0] as any;
    const samplePending = allAssignedStations[0] as any;
    const sampleCompleted = completedStations[0] as any;

    const zone =
      assignment?.zone ||
      assignment?.Zone ||
      samplePending?.Zone ||
      samplePending?.zone ||
      sampleCompleted?.Zone ||
      sampleCompleted?.zone ||
      '';

    const circle =
      assignment?.circle ||
      assignment?.Circle ||
      samplePending?.Circle ||
      samplePending?.circle ||
      sampleCompleted?.Circle ||
      sampleCompleted?.circle ||
      '';

    const division =
      assignment?.division ||
      assignment?.Division ||
      samplePending?.Division ||
      samplePending?.division ||
      sampleCompleted?.Division ||
      sampleCompleted?.division ||
      '';

    return {
      zone,
      circle,
      division,
      hasData: Boolean(zone || circle || division),
    };
  }, [dataResult, allAssignedStations, completedStations]);

  const renderHeader = () => (
    <View style={styles.headerComponent}>
      {/* Top App Bar */}
      <View style={styles.topBar}>
        <View style={styles.vendorIdentity}>
          <View style={styles.avatarPill}>
            <Text style={styles.avatarText}>
              {(currentVendor.CompanyName || 'VP').substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.vendorTextWrap}>
            <Text style={styles.vendorCompany} numberOfLines={1}>
              {currentVendor.CompanyName}
            </Text>
            <View style={styles.topStatusRow}>
              <Text style={styles.vendorUser} numberOfLines={1}>
                👤 {currentVendor.VendorName} • {currentVendor.ContactNumber}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <TouchableOpacity
                style={styles.sqliteStatusBadge}
                onPress={() => {
                  setShowSyncBanner(true);
                  if (syncState.status !== 'syncing') {
                    startBackgroundSQLiteSync(selectedVendorId, allAssignedStations);
                  }
                }}
                activeOpacity={0.7}>
                <View
                  style={[
                    styles.sqliteStatusDot,
                    syncState.status === 'syncing'
                      ? styles.sqliteDotSyncing
                      : styles.sqliteDotReady,
                  ]}
                />
                <Text style={styles.sqliteStatusText}>
                  {syncState.status === 'syncing'
                    ? 'Syncing ...'
                    : syncState.count > 0
                      ? `Synced (${syncState.count})`
                      : 'Ready'}
                </Text>
              </TouchableOpacity>

              {offlineQueueCount > 0 && (
                <TouchableOpacity
                  style={styles.queuePillTop}
                  onPress={() => setShowOfflineQueue(true)}
                  activeOpacity={0.7}>
                  <Text style={styles.queuePillTopText}>📦 Queue ({offlineQueueCount})</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={handleConfirmLogout}
          activeOpacity={0.7}>
          <Text style={styles.logoutBtnText}>Exit</Text>
        </TouchableOpacity>
      </View>

      {/* Territory & Jurisdiction Card */}
      {jurisdiction.hasData ? (
        <View style={styles.territoryCard}>
          <View style={styles.territoryHeader}>
            <Text style={styles.territoryTitle}>🌐 JURISDICTION ASSIGNMENT</Text>
            <View style={styles.statusLivePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>ACTIVE</Text>
            </View>
          </View>
          <View style={styles.territoryGrid}>
            <View style={styles.territoryCol}>
              <Text style={styles.territoryMeta}>Zone</Text>
              <Text style={styles.territoryVal}>{jurisdiction.zone || 'N/A'}</Text>
            </View>
            <View style={styles.territoryCol}>
              <Text style={styles.territoryMeta}>Circle</Text>
              <Text style={styles.territoryVal}>{jurisdiction.circle || 'N/A'}</Text>
            </View>
            <View style={styles.territoryCol}>
              <Text style={styles.territoryMeta}>Division</Text>
              <Text style={styles.territoryVal}>{jurisdiction.division || 'N/A'}</Text>
            </View>
          </View>
        </View>
      ) : null}

      {/* Local SQLite Database Sync Status Card */}
      <View style={styles.dbSyncCard}>
        {/* Top Header Row: Left (Icon + Title) & Right (15 Synced Badge) */}
        <View style={styles.dbSyncHeaderRow}>
          <View style={styles.dbSyncHeaderLeft}>
            <View
              style={[
                styles.dbSyncIconWrap,
                syncState.status === 'completed'
                  ? styles.dbSyncIconSuccess
                  : syncState.status === 'syncing'
                    ? styles.dbSyncIconSyncing
                    : styles.dbSyncIconReady,
              ]}>
              {syncState.status === 'syncing' ? (
                <ActivityIndicator size="small" color="#0284C7" />
              ) : (
                <Text style={styles.dbSyncIcon}>
                  {syncState.status === 'completed' || syncState.count > 0 ? '✅' : '💾'}
                </Text>
              )}
            </View>
            <Text style={styles.dbSyncTitle}>SQLite Local Database</Text>
          </View>

          {/* Synced Badge cleanly placed on the far right of header */}
          <View
            style={[
              styles.dbSyncBadge,
              syncState.status === 'syncing'
                ? styles.dbSyncBadgeSyncing
                : styles.dbSyncBadgeSuccess,
            ]}>
            <Text
              style={[
                styles.dbSyncBadgeText,
                syncState.status === 'syncing'
                  ? styles.dbSyncTextSyncing
                  : styles.dbSyncTextSuccess,
              ]}>
              {syncState.status === 'syncing'
                ? 'Syncing...'
                : syncState.count > 0
                  ? `✓ ${syncState.count} Synced`
                  : 'Ready'}
            </Text>
          </View>
        </View>

        {/* Subtitle description with breathing room */}
        <Text style={styles.dbSyncSub}>
          {syncState.status === 'syncing'
            ? `Syncing in background without UI freezing...`
            : syncState.count > 0
              ? `${syncState.count} pending stations stored offline. Available anytime.`
              : 'Pending stations sync automatically after every login.'}
        </Text>

        {/* Bottom Actions Row: Offline Queue Button & Resync Button */}
        <View style={styles.dbSyncActions}>
          <TouchableOpacity
            style={[
              styles.queueBtn,
              offlineQueueCount > 0 ? styles.queueBtnActive : styles.queueBtnInactive,
            ]}
            onPress={() => setShowOfflineQueue(true)}
            activeOpacity={0.75}>
            <Text
              style={[
                styles.queueBtnText,
                offlineQueueCount > 0 ? styles.queueTextActive : styles.queueTextInactive,
              ]}>
              📦 Offline Queue ({offlineQueueCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resyncBtn}
            onPress={() => {
              startBackgroundSQLiteSync(selectedVendorId, allAssignedStations);
            }}
            disabled={syncState.status === 'syncing'}
            activeOpacity={0.7}>
            <Text style={styles.resyncBtnText}>
              {syncState.status === 'syncing' ? '...' : '↻ Resync'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Metric Counters Banner - Independent apkfetchDashboardCount API */}
      <View style={styles.metricsRow}>
        <View style={[styles.metricCard, styles.metricCardBlue]}>
          <Text style={styles.metricLabel}>Total</Text>
          <Text style={styles.metricNumber}>
            {dashboardCounts?.TotalAssignedStationCount ?? '-'}
          </Text>
          <Text style={styles.metricSub}>Substations</Text>
        </View>

        <View style={[styles.metricCard, styles.metricCardGreen]}>
          <View style={styles.metricHeaderRow}>
            <Text style={styles.metricLabel}>Installed</Text>
            <Text style={styles.metricPercentBadge}>
              {dashboardCounts?.CompletedInstallationPercentage
                ? `${dashboardCounts.CompletedInstallationPercentage}%`
                : '0%'}
            </Text>
          </View>
          <Text style={styles.metricNumber}>
            {dashboardCounts?.CompletedInstallationCount ?? '-'}
          </Text>
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      parseFloat(
                        dashboardCounts?.CompletedInstallationPercentage || '0',
                      ),
                    ),
                  )}%`,
                },
              ]}
            />
          </View>
        </View>

        <View style={[styles.metricCard, styles.metricCardAmber]}>
          <Text style={styles.metricLabel}>Pending</Text>
          <Text style={styles.metricNumber}>
            {dashboardCounts?.PendingInstallationCount ?? '-'}
          </Text>
          <Text style={styles.metricSub}>In-Progress</Text>
        </View>
      </View>


      {/* Section Tab Switcher */}
      <View style={styles.tabNavRow}>
        <TouchableOpacity
          style={[
            styles.tabNavBtn,
            activeTab === 'pending' && styles.tabNavBtnActive,
          ]}
          onPress={() => setActiveTab('pending')}
          activeOpacity={0.75}>
          <Text
            style={[
              styles.tabNavText,
              activeTab === 'pending' && styles.tabNavTextActive,
            ]}>
            ⏳ Pending ({dashboardCounts?.PendingInstallationCount ?? allAssignedStations.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.tabNavBtn,
            activeTab === 'completed' && styles.tabNavBtnActiveGreen,
          ]}
          onPress={() => setActiveTab('completed')}
          activeOpacity={0.75}>
          <Text
            style={[
              styles.tabNavText,
              activeTab === 'completed' && styles.tabNavTextActiveGreen,
            ]}>
            ✓ Completed ({dashboardCounts?.CompletedInstallationCount ?? completedStations.length})
          </Text>
        </TouchableOpacity>
      </View>


      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={
            activeTab === 'completed'
              ? 'Search completed station, taluk, serial, installer...'
              : 'Search pending station, taluk, engineer, serial...'
          }
          placeholderTextColor="#64748B"
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Voltage Filter Pills */}
      <View style={styles.filtersRow}>
        {voltageOptions.map(volt => (
          <TouchableOpacity
            key={volt}
            style={[
              styles.filterPill,
              selectedVoltage === volt && styles.filterPillActive,
            ]}
            onPress={() => setSelectedVoltage(volt)}>
            <Text
              style={[
                styles.filterPillText,
                selectedVoltage === volt && styles.filterPillTextActive,
              ]}>
              {volt === 'ALL'
                ? `All (${activeTab === 'completed'
                  ? completedStations.length
                  : allAssignedStations.length
                })`
                : `${volt} kV`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List Header Title */}
      <View style={styles.listHeaderRow}>
        <Text style={styles.listHeaderTitle}>
          {activeTab === 'completed'
            ? `Completed Stations (${filteredCompletedStations.length})`
            : `Pending Stations (${filteredAssignedStations.length})`}
        </Text>
        <Text style={styles.listHeaderHint}>
          {activeTab === 'completed'
            ? 'Includes photo evidence & verification'
            : 'Tap station for specs & guidance'}
        </Text>
      </View>
    </View>
  );

  const renderStationCard = ({ item }: { item: StationItem }) => {
    return (
      <TouchableOpacity
        style={styles.stationCard}
        activeOpacity={0.85}
        onPress={() => {
          setSelectedStation(item);
        }}>
        <View style={styles.cardTop}>
          <View style={styles.stationTitleWrap}>
            <View
              style={[
                styles.voltageTag,
                item.VoltageClass === '220' || item.VoltageClass === '400'
                  ? styles.voltageHigh
                  : styles.voltageStandard,
              ]}>
              <Text
                style={[
                  styles.voltageTagText,
                  item.VoltageClass === '220' || item.VoltageClass === '400'
                    ? styles.voltageTextHigh
                    : styles.voltageTextStandard,
                ]}>
                {item.VoltageClass} kV
              </Text>
            </View>
            <Text style={styles.stationName} numberOfLines={1}>
              {item.Station}
            </Text>
          </View>
        </View>

        {/* Jurisdiction Meta: Zone, Circle, Division */}
        {(item.Zone || item.Circle || item.Division) ? (
          <View style={styles.cardJurisdictionRow}>
            <Text style={styles.cardJurisdictionText} numberOfLines={1}>
              🌐 {[item.Zone, item.Circle, item.Division].filter(Boolean).join(' • ')}
            </Text>
          </View>
        ) : null}

        <View style={styles.cardMetaRow}>
          <Text style={styles.talukText}>
            📍 {item.Taluk} • Pin: {item.PinCode}
          </Text>
        </View>

        <Text style={styles.stationAddress} numberOfLines={2}>
          {item.SubStationAddress}
        </Text>

        <View style={styles.cardDivider} />
        <View style={styles.cardFooter}>
          <View style={styles.engineerSection}>
            <Text style={styles.engineerLabel}>AE/JE In-Charge:</Text>
            <Text style={styles.engineerVal} numberOfLines={1}>
              {item.InChangreAEJEname || 'N/A'} ({item.ContactNumber || 'No Phone'})
            </Text>
          </View>

          <View style={styles.hardwareBadge}>
            <Text style={styles.hardwareLabel}>Switch S/N:</Text>
            <Text style={styles.hardwareVal}>{item.SwitchSerialNumber || '-'}</Text>
          </View>
        </View>

        <View style={styles.viewGuidanceRow}>
          <Text style={styles.viewGuidanceText}>
            📷 Upload Proof & View Station Specs ➔
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCompletedStationCard = ({ item }: { item: CompletedStationItem }) => {
    return (
      <CompletedStationCard
        item={item}
        onPress={() => {
          setSelectedStation(item);
        }}
      />
    );
  };

  const currentListData =
    activeTab === 'completed'
      ? filteredCompletedStations
      : filteredAssignedStations;

  if (showOfflineQueue) {
    return (
      <OfflineQueueScreen
        vendorId={selectedVendorId}
        onBack={() => {
          setShowOfflineQueue(false);
          refreshQueueCount();
        }}
        onSyncComplete={() => {
          refreshQueueCount();
          fetchAllData(selectedVendorId, false);
          fetchDashboardCounts(selectedVendorId);
        }}
      />
    );
  }

  if (selectedStation) {
    return (
      <StationDetailScreen
        station={selectedStation}
        currentVendor={currentVendor}
        isPending={activeTab === 'pending'}
        onBack={() => {
          setSelectedStation(null);
          refreshQueueCount();
        }}
        onSubmissionSuccess={() => {
          setSelectedStation(null);
          fetchAllData(selectedVendorId, false);
          fetchDashboardCounts(selectedVendorId);
          refreshQueueCount();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Persistent / Floating Background SQLite Sync Notification Banner */}
      {showSyncBanner && (
        <View
          style={[
            styles.syncBanner,
            syncState.status === 'completed'
              ? styles.syncBannerSuccess
              : syncState.status === 'syncing'
                ? styles.syncBannerSyncing
                : styles.syncBannerError,
          ]}>
          <View style={styles.syncBannerContent}>
            {syncState.status === 'syncing' ? (
              <ActivityIndicator size="small" color="#0284C7" style={{ marginRight: 10 }} />
            ) : (
              <Text style={styles.syncBannerIcon}>
                {syncState.status === 'completed' ? '✅' : '⚠️'}
              </Text>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.syncBannerTitle}>
                {syncState.status === 'syncing'
                  ? 'Syncing Pending Stations to SQLite...'
                  : syncState.status === 'completed'
                    ? 'SQLite Sync Completed 🎉'
                    : 'Database Notice'}
              </Text>
              <Text style={styles.syncBannerText}>{syncState.message}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowSyncBanner(false)}
              style={styles.syncBannerClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.syncBannerCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {isLoading && !isRefreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.loadingText}>Fetching Stations & Installations...</Text>
        </View>
      ) : errorMessage &&
        allAssignedStations.length === 0 &&
        completedStations.length === 0 ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>Unable to Load Data</Text>
          <Text style={styles.errorSub}>{errorMessage}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => fetchAllData(selectedVendorId)}>
            <Text style={styles.retryBtnText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key={`tab-${activeTab}`}
          data={currentListData as any}
          keyExtractor={(item: any) =>
            `${activeTab}-${item.VendorStationAssignmentId}-${item.ExcelDataId}`
          }
          renderItem={
            activeTab === 'completed'
              ? (renderCompletedStationCard as any)
              : (renderStationCard as any)
          }
          ListHeaderComponent={renderHeader()}
          keyboardShouldPersistTaps="handled"
          extraData={[
            activeTab,
            selectedVoltage,
            searchQuery,
            filteredCompletedStations,
            filteredAssignedStations,
            dashboardCounts,
            showSyncBanner,
            syncState,
          ]}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#38BDF8"
              colors={['#0284C7']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>
                {activeTab === 'completed' ? '🏁' : '⏳'}
              </Text>
              <Text style={styles.emptyTitle}>
                {searchQuery
                  ? 'No Stations Found'
                  : activeTab === 'completed'
                    ? 'No Completed Stations'
                    : 'No Pending Stations'}
              </Text>
              <Text style={styles.emptySub}>
                {searchQuery
                  ? 'No stations match your current search or voltage filter.'
                  : activeTab === 'completed'
                    ? `No verified completed installations on record for ${currentVendor.CompanyName}.`
                    : `All stations are currently completed or none are pending installation for ${currentVendor.CompanyName}.`}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  listContent: {
    paddingBottom: 40,
  },
  headerComponent: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  vendorIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarPill: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  vendorTextWrap: {
    flex: 1,
  },
  vendorCompany: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
  vendorUser: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  logoutBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutBtnText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '700',
  },
  territoryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  territoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  territoryTitle: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statusLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
    marginRight: 6,
  },
  liveText: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '800',
  },
  territoryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  territoryCol: {
    flex: 1,
  },
  territoryMeta: {
    color: '#64748B',
    fontSize: 11,
    marginBottom: 2,
  },
  territoryVal: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    justifyContent: 'space-between',
    minHeight: 82,
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  metricCardBlue: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  metricCardGreen: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  metricCardAmber: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  metricHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  metricPercentBadge: {
    color: '#047857',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: '#D1FAE5',
    borderRadius: 2,
    marginTop: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 2,
  },

  metricLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  metricNumber: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '800',
  },
  metricSub: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 2,
  },
  tabNavRow: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    gap: 4,
  },
  tabNavBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabNavBtnActive: {
    backgroundColor: '#2563EB',
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  tabNavBtnActiveGreen: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  tabNavText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  tabNavTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tabNavTextActiveGreen: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    padding: 0,
  },
  searchClear: {
    color: '#94A3B8',
    fontSize: 14,
    paddingHorizontal: 6,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  filterPillActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  filterPillText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  listHeaderTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  listHeaderHint: {
    color: '#64748B',
    fontSize: 11,
  },
  stationCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stationTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  voltageTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 8,
  },
  voltageStandard: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  voltageHigh: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  voltageTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  voltageTextStandard: {
    color: '#1D4ED8',
  },
  voltageTextHigh: {
    color: '#DC2626',
  },
  stationName: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusPillDone: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  statusPillPending: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextDone: {
    color: '#15803D',
  },
  statusTextPending: {
    color: '#B45309',
  },
  cardJurisdictionRow: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  cardJurisdictionText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '600',
  },
  cardMetaRow: {
    marginBottom: 6,
  },
  talukText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
  },
  stationAddress: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 10,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginBottom: 10,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  engineerSection: {
    flex: 1,
  },
  engineerLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
  },
  engineerVal: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  hardwareBadge: {
    alignItems: 'flex-end',
  },
  hardwareLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
  },
  hardwareVal: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  viewGuidanceRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'flex-end',
  },
  viewGuidanceText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  loadingText: {
    color: '#64748B',
    marginTop: 14,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  errorEmoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  errorTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorSub: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  retryBtn: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyEmoji: {
    fontSize: 32,
    marginBottom: 10,
  },
  emptyTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySub: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
  },
  topStatusRow: {
    marginTop: 2,
  },
  sqliteStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sqliteStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  sqliteDotReady: {
    backgroundColor: '#10B981',
  },
  sqliteDotSyncing: {
    backgroundColor: '#0284C7',
  },
  sqliteStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  syncBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 6,
    borderWidth: 1,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 4,
    zIndex: 999,
  },
  syncBannerSuccess: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  syncBannerSyncing: {
    backgroundColor: '#F0F9FF',
    borderColor: '#BAE6FD',
  },
  syncBannerError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  syncBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncBannerIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  syncBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  syncBannerText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 16,
  },
  syncBannerClose: {
    padding: 6,
    marginLeft: 8,
  },
  syncBannerCloseText: {
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '700',
  },
  dbSyncCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  dbSyncHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  dbSyncHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  dbSyncIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  dbSyncIconSuccess: {
    backgroundColor: '#DCFCE7',
  },
  dbSyncIconSyncing: {
    backgroundColor: '#E0F2FE',
  },
  dbSyncIconReady: {
    backgroundColor: '#F1F5F9',
  },
  dbSyncIcon: {
    fontSize: 18,
  },
  dbSyncTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flexShrink: 1,
  },
  dbSyncBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'center',
  },
  dbSyncBadgeSuccess: {
    backgroundColor: '#DCFCE7',
  },
  dbSyncBadgeSyncing: {
    backgroundColor: '#E0F2FE',
  },
  dbSyncBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  dbSyncTextSuccess: {
    color: '#15803D',
  },
  dbSyncTextSyncing: {
    color: '#0284C7',
  },
  dbSyncSub: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 12,
  },
  dbSyncActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 10,
  },
  resyncBtn: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resyncBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  queueBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  queueBtnActive: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  queueBtnInactive: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  queueBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  queueTextActive: {
    color: '#B45309',
  },
  queueTextInactive: {
    color: '#64748B',
  },
  queuePillTop: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  queuePillTopText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
});
