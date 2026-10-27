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
  Modal,
  ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { apiService } from '../api/apiService';
import {
  VendorProfile,
  StationItem,
  AssignmentItem,
  FetchVendorDetailResult,
  FetchVendorDetailResponse,
  CompletedStationItem,
  FetchCompletedStationsResponse,
  DashboardCountData,
  WorkerPendingStationItem,
  WorkerCompletedStationItem,
  SingleStationWorkerDropdownItem,
} from '../types';
import { StationDetailScreen } from './StationDetailScreen';
import { OfflineQueueScreen } from './OfflineQueueScreen';
import { VendorWorkersScreen } from './VendorWorkersScreen';
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
  const isWorker =
    currentVendor.RoleId === 9 ||
    currentVendor.userType === 'VendorWorker' ||
    Boolean(currentVendor.VendorWorkerId);
  const activeWorkerId =
    currentVendor.VendorWorkerId || (currentVendor as any).WorkerId || null;
  const vendorDisplayName = isWorker
    ? (currentVendor.UserName || 'Vendor Worker')
    : (currentVendor.CompanyName || currentVendor.VendorName || 'Vendor');

  const [dataResult, setDataResult] = useState<FetchVendorDetailResult | null>(null);
  const [completedStations, setCompletedStations] = useState<CompletedStationItem[]>([]);
  const [dashboardCounts, setDashboardCounts] = useState<DashboardCountData | null>(null);
  const [activeTab, setActiveTab] = useState<'pending' | 'completed'>('pending');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Independent fetch for dashboard metrics counts (vendor only)
  const fetchDashboardCounts = async (vendorId: number) => {
    if (isWorker) return;
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
  const [showWorkersScreen, setShowWorkersScreen] = useState<boolean>(false);
  const [workersInitialTab, setWorkersInitialTab] = useState<'list' | 'assign' | 'assigned' | 'create'>('list');

  // Single station worker assignment state
  const [assignModalStation, setAssignModalStation] = useState<StationItem | null>(null);
  const [assignWorkersList, setAssignWorkersList] = useState<SingleStationWorkerDropdownItem[]>([]);
  const [isLoadingAssignWorkers, setIsLoadingAssignWorkers] = useState<boolean>(false);
  const [selectedAssignWorker, setSelectedAssignWorker] = useState<SingleStationWorkerDropdownItem | null>(null);
  const [isSubmittingSingleAssign, setIsSubmittingSingleAssign] = useState<boolean>(false);
  const [assignWorkerSearch, setAssignWorkerSearch] = useState<string>('');

  const filteredAssignWorkers = useMemo(() => {
    if (!assignWorkerSearch.trim()) return assignWorkersList;
    const q = assignWorkerSearch.toLowerCase().trim();
    return assignWorkersList.filter(
      w =>
        (w.WorkerName || '').toLowerCase().includes(q) ||
        String(w.WorkerId).includes(q),
    );
  }, [assignWorkersList, assignWorkerSearch]);

  const handleOpenAssignModal = async (station: StationItem) => {
    setAssignModalStation(station);
    setSelectedAssignWorker(null);
    setAssignWorkerSearch('');
    setIsLoadingAssignWorkers(true);
    try {
      const workers = await apiService.fetchSingleStationWorkers(currentVendor.VendorId, 2);
      setAssignWorkersList(workers);
      if (station.WorkerId) {
        const existing = workers.find(w => w.WorkerId === station.WorkerId);
        if (existing) {
          setSelectedAssignWorker(existing);
        }
      }
    } catch (err: any) {
      Alert.alert('Worker List Error', err?.message || 'Failed to fetch workers list.');
    } finally {
      setIsLoadingAssignWorkers(false);
    }
  };

  const handleConfirmSingleStationAssign = async () => {
    if (!assignModalStation || !selectedAssignWorker) {
      Alert.alert('Selection Required', 'Please select a worker to assign this station.');
      return;
    }

    const vendorAssignmentId =
      assignModalStation.VendorAssignmentId ||
      (assignModalStation as any).vendorAssignmentId ||
      0;

    const excelDataId = assignModalStation.ExcelDataId;

    const vendorName = currentVendor.VendorName || currentVendor.CompanyName || 'Vendor';
    const contactNumber = currentVendor.ContactNumber || currentVendor.MobileNumber || '';
    const createdBy = contactNumber ? `${vendorName} - ${contactNumber}` : vendorName;

    setIsSubmittingSingleAssign(true);
    try {
      const res = await apiService.insertSingleStationAssignToWorker({
        flagId: 1,
        WorkerId: selectedAssignWorker.WorkerId,
        VendorId: currentVendor.VendorId,
        vendorAssignmentId,
        ExcelDataId: excelDataId,
        CreatedByUserName: createdBy,
      });

      Alert.alert(
        'Assigned Successfully! 🎉',
        res.message || `Station "${assignModalStation.Station}" has been assigned to ${selectedAssignWorker.WorkerName}.`,
        [
          {
            text: 'Great',
            onPress: () => {
              setAssignModalStation(null);
              fetchAllData(selectedVendorId, false);
            },
          },
        ],
      );
    } catch (err: any) {
      Alert.alert('Assignment Error', err?.message || 'Failed to assign station to worker.');
    } finally {
      setIsSubmittingSingleAssign(false);
    }
  };

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
      // Pending stations promise:
      // If Worker: use fetchPendingWorkerList with { flagId: 1, WorkerId: activeWorkerId }
      // If Vendor: use fetchVendorWiseDetail with { VendorId: vendorId, flagId: 2 }
      const pendingPromise = activeWorkerId
        ? apiService.fetchPendingWorkerList(activeWorkerId, 1)
        : apiService.fetchVendorWiseDetail(vendorId, 2);

      // Completed stations promise:
      // If Worker: use fetchPendingWorkerList with { flagId: 2, WorkerId: activeWorkerId }
      // If Vendor: use fetchCompletedStations with { VendorId: vendorId, flagId: 2 }
      const completedPromise = activeWorkerId
        ? apiService.fetchPendingWorkerList(activeWorkerId, 2)
        : apiService.fetchCompletedStations(vendorId, 2);

      const [pendingRes, completedRes] = await Promise.allSettled([
        pendingPromise,
        completedPromise,
      ]);

      let hasData = false;

      if (pendingRes.status === 'fulfilled') {
        if (activeWorkerId) {
          // Process Worker Pending Stations from fetchPendingWorkerList
          const workerStations: WorkerPendingStationItem[] = Array.isArray(pendingRes.value)
            ? pendingRes.value
            : [];
          if (workerStations.length > 0) {
            hasData = true;
          }

          // Map worker pending items to StationItem format
          const mappedStations: StationItem[] = workerStations.map(item => ({
            VendorStationAssignmentId: item.WorkerStationAssignmentId || 0,
            WorkerStationAssignmentId: item.WorkerStationAssignmentId || 0,
            WorkerId: item.WorkerId || activeWorkerId || 0,
            VendorAssignmentId: item.VendorAssignmentId || 0,
            ExcelDataId: item.ExcelDataId,
            VendorStatusId: item.StatusId || 1,
            IsDisabled: item.AssignmentIsDisabled || false,
            CreatedAt: item.AssignmentCreatedAt || '',
            UpdatedAt: item.AssignmentUpdatedAt || null,
            Station: item.Station || '',
            Taluk: item.Taluk || '',
            VoltageClass: item.VoltageClass || '',
            InChangreAEJEname: item.InChangreAEJEname || '',
            ContactNumber: item.StationContactNumber || '',
            SubStationAddress: item.SubStationAddress || '',
            PinCode: item.PinCode || '',
            Latitude: item.Latitude || '',
            Longitude: item.Longitude || '',
            Zone: item.Zone || '',
            Circle: item.Circle || '',
            Division: item.Division || '',
            RouteStationStatusId: 0,
            StatusId: item.StatusId || 1,
            VisitedAt: '',
            StationRemarks: null,
            StationSubmissionId: 0,
            SubmissionRemarks: '',
            SubmissionCreatedAt: '',
            SubmissionUpdatedAt: null,
            CreatedByDriverId: 0,
            SwitchSerialNumber: item.SwitchSerialNumber || '',
            ResilientSerialNumber: item.ResilientSerialNumber || '',
            SwitchFirmWareNumber: item.SwitchFirmWareNumber || '',
            PendingFileTypes: item.PendingFileTypeIds || item.PendingFileTypes || [],
            PendingFileTypeIds: item.PendingFileTypeIds || [],
            VendorStatusName: item.StatusId === 2 ? 'Draft' : (item.VendorStatusName || 'Pending'),
            ...(item as any),
          }));

          // Group mapped stations into assignments by VendorAssignmentId
          const assignmentMap = new Map<number, StationItem[]>();
          mappedStations.forEach(st => {
            const vId = st.VendorAssignmentId || 0;
            if (!assignmentMap.has(vId)) assignmentMap.set(vId, []);
            assignmentMap.get(vId)!.push(st);
          });

          const assignments: AssignmentItem[] = [];
          assignmentMap.forEach((stations, vAssignmentId) => {
            const first = stations[0];
            assignments.push({
              vendorAssignmentId: vAssignmentId,
              vendorId: (first as any).VendorId || vendorId,
              zone: first.Zone || '',
              circle: first.Circle || '',
              division: first.Division || '',
              vendorStatusId: 1,
              assignedAt: first.CreatedAt || new Date().toISOString(),
              stationCount: stations.length,
              completedStationCount: 0,
              pendingStationCount: stations.length,
              stations,
            });
          });

          const firstRaw = workerStations[0];
          setDataResult({
            vendor: {
              VendorId: firstRaw?.VendorId || currentVendor.VendorId || vendorId,
              VendorName: firstRaw?.VendorName || currentVendor.VendorName || '',
              CompanyName: firstRaw?.CompanyName || currentVendor.CompanyName || '',
              ContactPerson: firstRaw?.VendorContactPerson || currentVendor.ContactPerson || '',
              ContactNumber: firstRaw?.VendorContactNumber || currentVendor.ContactNumber || '',
              EmailAddress: firstRaw?.VendorEmailAddress || currentVendor.EmailAddress || '',
            },
            assignments,
          });

          if (mappedStations.length > 0) {
            startBackgroundSQLiteSync(vendorId, mappedStations);
          }
        } else {
          // Process Vendor Wise Detail from apkFetchVendorWiseDetail
          const vendorRes = pendingRes.value as FetchVendorDetailResponse;
          if (vendorRes?.status && vendorRes.result) {
            setDataResult(vendorRes.result);
            if (vendorRes.result.assignments?.length > 0) {
              hasData = true;

              // Extract all pending stations across assignments and sync to SQLite
              const pendingList: StationItem[] = [];
              vendorRes.result.assignments.forEach((assignment: AssignmentItem) => {
                if (assignment.stations && Array.isArray(assignment.stations)) {
                  pendingList.push(...assignment.stations);
                }
              });

              if (pendingList.length > 0) {
                startBackgroundSQLiteSync(vendorId, pendingList);
              }
            }
          }
        }
      }

      let fetchedCompleted: CompletedStationItem[] = [];
      if (completedRes.status === 'fulfilled') {
        if (activeWorkerId) {
          // Process Worker Completed Stations from fetchPendingWorkerList (flagId: 2)
          const rawItems: any[] = Array.isArray(completedRes.value) ? completedRes.value : [];
          fetchedCompleted = rawItems.map(item => ({
            VendorStationAssignmentId: item.WorkerStationAssignmentId || item.VendorStationAssignmentId || 0,
            VendorAssignmentId: item.VendorAssignmentId || 0,
            ExcelDataId: item.ExcelDataId,
            VendorStatusId: item.StatusId || 3,
            StatusId: item.StatusId || 3,
            CreatedAt: item.AssignmentCreatedAt || item.CreatedAt || '',
            UpdatedAt: item.AssignmentUpdatedAt || item.UpdatedAt || null,
            VendorId: item.VendorId || vendorId,
            Zone: item.Zone || '',
            Circle: item.Circle || '',
            Division: item.Division || '',
            AssignedAt: item.AssignmentCreatedAt || item.CreatedAt || '',
            VendorName: item.VendorName || '',
            CompanyName: item.CompanyName || '',
            ContactPerson: item.VendorContactPerson || item.ContactPerson || '',
            VendorContactNumber: item.VendorContactNumber || '',
            VendorEmailAddress: item.VendorEmailAddress || '',
            Station: item.Station || '',
            Taluk: item.Taluk || '',
            VoltageClass: item.VoltageClass || '',
            InChangreAEJEname: item.InChangreAEJEname || '',
            StationContactNumber: item.StationContactNumber || '',
            SubStationAddress: item.SubStationAddress || '',
            PinCode: item.PinCode || '',
            Latitude: item.Latitude || '',
            Longitude: item.Longitude || '',
            RouteStationStatusId: 0,
            VisitedAt: item.InstallationCreatedAt || item.AssignmentUpdatedAt || null,
            StationRemarks: item.InstallationRemarks || null,
            StationSubmissionId: item.InstallationSubmissionId || null,
            SubmissionRemarks: item.InstallationRemarks || '',
            SubmissionCreatedAt: item.InstallationCreatedAt || null,
            SubmissionUpdatedAt: item.InstallationUpdatedAt || null,
            CreatedByDriverId: null,
            SwitchSerialNumber: item.SwitchSerialNumber || null,
            ResilientSerialNumber: item.ResilientSerialNumber || null,
            SwitchFirmWareNumber: item.SwitchFirmWareNumber || null,
            InstallationSubmissionId: item.InstallationSubmissionId || null,
            InstallationStatusId: item.InstallationStatusId || 3,
            InstallationCreatedAt: item.InstallationCreatedAt || null,
            InstallationUpdatedAt: item.InstallationUpdatedAt || null,
            InstallationCreatedByUserName:
              item.InstallationCreatedByUserName ||
              item.UpdatedByUserName ||
              item.WorkerName ||
              null,
            InstallationUpdatedByUserName:
              item.InstallationUpdatedByUserName || item.UpdatedByUserName || null,
            InstallationRemarks: item.InstallationRemarks || null,
            InstallationVendorId: item.InstallationVendorId || item.VendorId || null,
            files: item.files || [],
            ...item,
          }));
        } else {
          // Process Vendor Completed Stations from fetchCompletedStations
          const vendorCompletedRes = completedRes.value as FetchCompletedStationsResponse;
          if (vendorCompletedRes?.status) {
            fetchedCompleted = vendorCompletedRes.data || [];
          }
        }
        setCompletedStations(fetchedCompleted);
        if (fetchedCompleted.length > 0) {
          hasData = true;
        }
      }

      // If this vendor has completed stations but 0 assigned stations, auto-switch to completed tab
      const assignedCount =
        dataResult?.assignments?.reduce(
          (acc, a) => acc + (a.stations?.length || 0),
          0,
        ) || 0;

      if (assignedCount === 0 && fetchedCompleted.length > 0) {
        setActiveTab('completed');
      }

      if (
        !hasData &&
        pendingRes.status === 'rejected' &&
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
      setErrorMessage(err.message || 'Failed to fetch assignments from RNA service.');
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
          <View style={[styles.avatarPill, isWorker && styles.avatarPillWorker]}>
            <Text style={styles.avatarText}>
              {isWorker
                ? (currentVendor.UserName || 'WK').substring(0, 2).toUpperCase()
                : (currentVendor.VendorName || currentVendor.CompanyName || 'VP').substring(0, 2).toUpperCase()}
            </Text>
          </View>
          <View style={styles.vendorTextWrap}>
            <View style={styles.vendorTitleRow}>
              <Text style={styles.vendorCompany} numberOfLines={1}>
                {vendorDisplayName}
              </Text>
              <View
                style={[
                  styles.roleBadgePill,
                  isWorker ? styles.roleBadgeWorker : styles.roleBadgeVendor,
                ]}>
                <Text
                  style={[
                    styles.roleBadgeText,
                    isWorker ? styles.roleTextWorker : styles.roleTextVendor,
                  ]}>
                  {isWorker ? '👷 WORKER' : '🏢 VENDOR'}
                </Text>
              </View>
            </View>
            <View style={styles.topStatusRow}>
              <Text style={styles.vendorUser} numberOfLines={1}>
                {isWorker
                  ? `👷 ${currentVendor.UserName || 'Worker'} • ${currentVendor.MobileNumber || currentVendor.ContactNumber} (ID #${currentVendor.VendorWorkerId || currentVendor.VendorId})`
                  : `👤 ${currentVendor.VendorName || currentVendor.ContactPerson || 'Vendor'} • ${currentVendor.ContactNumber} (ID #${currentVendor.VendorId})`}
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
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Field Worker Management Card (Vendor Only - Dedicated, Highly Visible Section) */}
      {!isWorker && (
        <View style={styles.workerMgmtCard}>
          <View style={styles.workerMgmtLeft}>
            <View style={styles.workerMgmtIconBox}>
              <Text style={styles.workerMgmtIcon}>👥</Text>
            </View>
            <View style={styles.workerMgmtInfo}>
              <Text style={styles.workerMgmtTitle}>Field Worker Management</Text>
              <Text style={styles.workerMgmtDesc}>
                Assign substations, manage field team, view assignments & reset passwords
              </Text>
            </View>
          </View>
          <View style={styles.workerMgmtActionsGroup}>
            <TouchableOpacity
              style={styles.workerMgmtAction}
              onPress={() => {
                setWorkersInitialTab('list');
                setShowWorkersScreen(true);
              }}
              activeOpacity={0.8}>
              <View style={styles.workerMgmtBadge}>
                <Text style={styles.workerMgmtBadgeText}>TEAM</Text>
              </View>
              <Text style={styles.workerMgmtActionText}>Directory</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.workerMgmtActionAssigned}
              onPress={() => {
                setWorkersInitialTab('assigned');
                setShowWorkersScreen(true);
              }}
              activeOpacity={0.8}>
              <Text style={styles.workerMgmtActionAssignedText}>📋 Assigned →</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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

      {/* Metric Counters Banner */}
      <View style={styles.metricsRow}>
        <View style={[styles.metricCard, styles.metricCardBlue]}>
          <Text style={styles.metricLabel}>Total</Text>
          <Text style={styles.metricNumber}>
            {dashboardCounts?.TotalAssignedStationCount ?? (isWorker ? stats.total : '-')}
          </Text>
          <Text style={styles.metricSub}>Substations</Text>
        </View>

        <View style={[styles.metricCard, styles.metricCardGreen]}>
          <View style={styles.metricHeaderRow}>
            <Text style={styles.metricLabel}>Installed</Text>
            <Text style={styles.metricPercentBadge}>
              {dashboardCounts?.CompletedInstallationPercentage
                ? `${dashboardCounts.CompletedInstallationPercentage}%`
                : stats.total > 0
                  ? `${Math.round((stats.completed / stats.total) * 100)}%`
                  : '0%'}
            </Text>
          </View>
          <Text style={styles.metricNumber}>
            {dashboardCounts?.CompletedInstallationCount ?? (isWorker ? stats.completed : '-')}
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
                        dashboardCounts?.CompletedInstallationPercentage ||
                          (stats.total > 0
                            ? String(Math.round((stats.completed / stats.total) * 100))
                            : '0'),
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
            {dashboardCounts?.PendingInstallationCount ?? (isWorker ? stats.pending : '-')}
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
    const isDraft =
      item.StatusId === 2 ||
      item.VendorStatusId === 2 ||
      (item as any).InstallationSubmissionStatusId === 2 ||
      item.VendorStatusName === 'Draft' ||
      (item as any).InstallationSubmissionStatusName === 'Draft' ||
      Boolean(
        (item.PendingFileTypes && item.PendingFileTypes.length > 0) ||
        ((item as any).PendingFileTypeIds && (item as any).PendingFileTypeIds.length > 0),
      );

    const pendingCount =
      item.PendingFileTypes?.length ??
      (item as any).PendingFileTypeIds?.length ??
      0;

    const isAssignedToWorker = Boolean(
      item.WorkerId != null &&
      item.WorkerName &&
      typeof item.WorkerName === 'string' &&
      item.WorkerName.trim() !== '' &&
      item.WorkerName.toLowerCase() !== 'null' &&
      item.WorkerName.toLowerCase() !== 'undefined'
    );

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

          {isDraft ? (
            <View style={styles.cardDraftBadge}>
              <Text style={styles.cardDraftBadgeText}>
                📝 Draft {pendingCount > 0 ? `(${pendingCount} Left)` : ''}
              </Text>
            </View>
          ) : (
            <View style={styles.cardPendingBadge}>
              <Text style={styles.cardPendingBadgeText}>⏳ Pending</Text>
            </View>
          )}
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

        {/* Worker Assignment Status (when assigned to worker) */}
        {!isWorker && isAssignedToWorker && (
          <View style={styles.assignedWorkerCardRow}>
            <View style={styles.assignedWorkerBadge}>
              <Text style={styles.assignedWorkerIcon}>👷</Text>
              <Text style={styles.assignedWorkerLabel}>Assigned to Worker:</Text>
              <Text style={styles.assignedWorkerName} numberOfLines={1}>
                {item.WorkerName}
              </Text>
            </View>
          </View>
        )}

        {/* Small "Assign to Worker" Button (Vendor Only, ONLY on pure Pending, NOT on Draft, and NOT when already assigned) */}
        {!isWorker && !isDraft && !isAssignedToWorker && (
          <View style={styles.cardAssignActionRow}>
            <TouchableOpacity
              style={styles.cardAssignSmallBtn}
              activeOpacity={0.8}
              onPress={() => handleOpenAssignModal(item)}>
              <Text style={styles.cardAssignSmallBtnIcon}>👤</Text>
              <Text style={styles.cardAssignSmallBtnText}>Assign to Worker</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.viewGuidanceRow}>
          <Text style={[styles.viewGuidanceText, isDraft && styles.viewGuidanceTextDraft]}>
            {isDraft
              ? `📝 Resume Upload (${pendingCount > 0 ? `${pendingCount} photos remaining` : 'Draft'}) ➔`
              : '📷 Upload Proof & View Station Specs ➔'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderCompletedStationCard = ({ item }: { item: CompletedStationItem }) => {
    return (
      <CompletedStationCard
        item={item}
        isWorker={isWorker}
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

  if (showWorkersScreen) {
    return (
      <VendorWorkersScreen
        currentVendor={currentVendor}
        initialTab={workersInitialTab}
        onBack={() => setShowWorkersScreen(false)}
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
                    ? `No verified completed installations on record for ${vendorDisplayName}.`
                    : `All stations are currently completed or none are pending installation for ${vendorDisplayName}.`}
              </Text>
            </View>
          }
        />
      )}

      {/* Single Station Worker Assignment Modal */}
      <Modal
        visible={!!assignModalStation}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!isSubmittingSingleAssign) setAssignModalStation(null);
        }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.assignModalOverlay}>
          <View style={styles.assignModalContainer}>
            {/* Modal Header */}
            <View style={styles.assignModalHeader}>
              <View style={styles.assignModalHeaderTitleWrap}>
                <View style={styles.assignModalIconWrap}>
                  <Text style={styles.assignModalIcon}>👤</Text>
                </View>
                <View style={styles.assignModalTitleTextWrap}>
                  <Text style={styles.assignModalTitle}>Assign Station to Worker</Text>
                  <Text style={styles.assignModalSubtitle} numberOfLines={1}>
                    {assignModalStation?.Station} ({assignModalStation?.VoltageClass} kV)
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.assignModalCloseBtn}
                onPress={() => {
                  if (!isSubmittingSingleAssign) setAssignModalStation(null);
                }}
                disabled={isSubmittingSingleAssign}>
                <Text style={styles.assignModalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Station Summary Strip */}
            {assignModalStation && (
              <View style={styles.assignStationSummaryCard}>
                <View style={styles.assignStationInfoRow}>
                  <Text style={styles.assignStationInfoLabel}>📍 Substation:</Text>
                  <Text style={styles.assignStationInfoVal} numberOfLines={1}>
                    {assignModalStation.Station} ({assignModalStation.Taluk})
                  </Text>
                </View>
                <View style={styles.assignStationInfoRow}>
                  <Text style={styles.assignStationInfoLabel}>🏷️ Assignment ID:</Text>
                  <Text style={styles.assignStationInfoVal}>
                    #{assignModalStation.VendorAssignmentId} • Excel #{assignModalStation.ExcelDataId}
                  </Text>
                </View>
                {assignModalStation.WorkerName ? (
                  <View style={styles.assignStationInfoRow}>
                    <Text style={styles.assignStationInfoLabel}>👷 Currently Assigned:</Text>
                    <Text style={styles.assignStationInfoValHighlighted}>
                      {assignModalStation.WorkerName}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Worker Search Bar */}
            <View style={styles.assignWorkerSearchBox}>
              <Text style={styles.assignWorkerSearchIcon}>🔍</Text>
              <TextInput
                style={styles.assignWorkerSearchInput}
                placeholder="Search worker by name or mobile..."
                placeholderTextColor="#94A3B8"
                value={assignWorkerSearch}
                onChangeText={setAssignWorkerSearch}
                clearButtonMode="while-editing"
              />
              {assignWorkerSearch.length > 0 && (
                <TouchableOpacity onPress={() => setAssignWorkerSearch('')}>
                  <Text style={styles.assignWorkerSearchClear}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Worker Selection List */}
            <View style={styles.assignWorkerListContainer}>
              <Text style={styles.assignWorkerListHeading}>
                Select Field Worker ({filteredAssignWorkers.length})
              </Text>

              {isLoadingAssignWorkers ? (
                <View style={styles.assignWorkerLoadingBox}>
                  <ActivityIndicator size="small" color="#2563EB" />
                  <Text style={styles.assignWorkerLoadingText}>
                    Loading workers from server...
                  </Text>
                </View>
              ) : filteredAssignWorkers.length === 0 ? (
                <View style={styles.assignWorkerEmptyBox}>
                  <Text style={styles.assignWorkerEmptyEmoji}>👥</Text>
                  <Text style={styles.assignWorkerEmptyTitle}>No Workers Found</Text>
                  <Text style={styles.assignWorkerEmptySub}>
                    {assignWorkerSearch
                      ? 'No field worker matches your search.'
                      : 'No workers found for your vendor account. Add workers via Field Worker Management first.'}
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={styles.assignWorkerScrollView}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled">
                  {filteredAssignWorkers.map(worker => {
                    const isSelected = selectedAssignWorker?.WorkerId === worker.WorkerId;
                    return (
                      <TouchableOpacity
                        key={worker.WorkerId}
                        style={[
                          styles.assignWorkerCard,
                          isSelected && styles.assignWorkerCardSelected,
                        ]}
                        activeOpacity={0.7}
                        onPress={() => setSelectedAssignWorker(worker)}>
                        <View style={styles.assignWorkerCardLeft}>
                          <View
                            style={[
                              styles.assignWorkerAvatar,
                              isSelected && styles.assignWorkerAvatarSelected,
                            ]}>
                            <Text style={styles.assignWorkerAvatarText}>👷</Text>
                          </View>
                          <View style={styles.assignWorkerDetails}>
                            <Text
                              style={[
                                styles.assignWorkerName,
                                isSelected && styles.assignWorkerNameSelected,
                              ]}
                              numberOfLines={1}>
                              {worker.WorkerName}
                            </Text>
                            <Text style={styles.assignWorkerIdText}>
                              Worker ID #{worker.WorkerId}
                            </Text>
                          </View>
                        </View>
                        <View
                          style={[
                            styles.assignRadioCircle,
                            isSelected && styles.assignRadioCircleSelected,
                          ]}>
                          {isSelected && <View style={styles.assignRadioDot} />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {/* Footer Buttons */}
            <View style={styles.assignModalFooter}>
              <TouchableOpacity
                style={styles.assignModalCancelBtn}
                onPress={() => {
                  if (!isSubmittingSingleAssign) setAssignModalStation(null);
                }}
                disabled={isSubmittingSingleAssign}
                activeOpacity={0.7}>
                <Text style={styles.assignModalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.assignModalConfirmBtn,
                  (!selectedAssignWorker || isSubmittingSingleAssign) &&
                    styles.assignModalConfirmBtnDisabled,
                ]}
                onPress={handleConfirmSingleStationAssign}
                disabled={!selectedAssignWorker || isSubmittingSingleAssign}
                activeOpacity={0.85}>
                {isSubmittingSingleAssign ? (
                  <View style={styles.assignModalBtnLoadingRow}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.assignModalConfirmBtnText}>Assigning...</Text>
                  </View>
                ) : (
                  <Text style={styles.assignModalConfirmBtnText}>
                    {selectedAssignWorker
                      ? `Assign to ${selectedAssignWorker.WorkerName.split('-')[0].trim()}`
                      : 'Select a Worker'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  avatarPillWorker: {
    backgroundColor: '#0D9488',
    shadowColor: '#0D9488',
  },
  avatarText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  vendorTextWrap: {
    flex: 1,
  },
  vendorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadgePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleBadgeVendor: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  roleBadgeWorker: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  roleTextVendor: {
    color: '#1D4ED8',
  },
  roleTextWorker: {
    color: '#0F766E',
  },
  vendorCompany: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    maxWidth: '70%',
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
  workerMgmtCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    shadowColor: '#0F766E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  workerMgmtLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  workerMgmtIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#99F6E4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  workerMgmtIcon: {
    fontSize: 22,
  },
  workerMgmtInfo: {
    flex: 1,
  },
  workerMgmtTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  workerMgmtBadge: {
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginRight: 2,
  },
  workerMgmtBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0F766E',
    letterSpacing: 0.5,
  },
  workerMgmtDesc: {
    fontSize: 11,
    color: '#64748B',
    lineHeight: 15,
  },
  workerMgmtActionsGroup: {
    flexDirection: 'column',
    gap: 6,
    alignItems: 'stretch',
  },
  workerMgmtAction: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  workerMgmtActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  workerMgmtActionAssigned: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerMgmtActionAssignedText: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '700',
  },
  cardDraftBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  cardDraftBadgeText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '700',
  },
  cardPendingBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardPendingBadgeText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  viewGuidanceTextDraft: {
    color: '#D97706',
    fontWeight: '700',
  },
  cardAssignActionRow: {
    marginTop: 8,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardAssignSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1.2,
    borderColor: '#3B82F6',
    borderRadius: 7,
    paddingVertical: 5,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
    gap: 5,
  },
  cardAssignSmallBtnIcon: {
    fontSize: 12,
  },
  cardAssignSmallBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  assignedWorkerCardRow: {
    marginTop: 8,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  assignedWorkerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 7,
    paddingVertical: 4,
    paddingHorizontal: 9,
    alignSelf: 'flex-start',
    gap: 6,
  },
  assignedWorkerIcon: {
    fontSize: 13,
  },
  assignedWorkerLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#15803D',
  },
  assignedWorkerName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#166534',
  },
  assignModalOverlay: {
    flex: 1,
    backgroundColor: '#0F172ACC',
    justifyContent: 'flex-end',
  },
  assignModalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '85%',
  },
  assignModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  assignModalHeaderTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  assignModalIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  assignModalIcon: {
    fontSize: 18,
  },
  assignModalTitleTextWrap: {
    flex: 1,
  },
  assignModalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  assignModalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 1,
  },
  assignModalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignModalCloseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  assignStationSummaryCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 4,
  },
  assignStationInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assignStationInfoLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  assignStationInfoVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
    flex: 1,
  },
  assignStationInfoValHighlighted: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563EB',
    flex: 1,
  },
  assignWorkerSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    height: 42,
  },
  assignWorkerSearchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  assignWorkerSearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
    paddingVertical: 0,
  },
  assignWorkerSearchClear: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    padding: 4,
  },
  assignWorkerListContainer: {
    marginTop: 12,
    flexShrink: 1,
  },
  assignWorkerListHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  assignWorkerLoadingBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  assignWorkerLoadingText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  assignWorkerEmptyBox: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  assignWorkerEmptyEmoji: {
    fontSize: 28,
  },
  assignWorkerEmptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  assignWorkerEmptySub: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 16,
  },
  assignWorkerScrollView: {
    maxHeight: 220,
  },
  assignWorkerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  assignWorkerCardSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  assignWorkerCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  assignWorkerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignWorkerAvatarSelected: {
    backgroundColor: '#DBEAFE',
  },
  assignWorkerAvatarText: {
    fontSize: 18,
  },
  assignWorkerDetails: {
    flex: 1,
  },
  assignWorkerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  assignWorkerNameSelected: {
    color: '#1D4ED8',
    fontWeight: '800',
  },
  assignWorkerIdText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  assignRadioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignRadioCircleSelected: {
    borderColor: '#2563EB',
  },
  assignRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563EB',
  },
  assignModalFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  assignModalCancelBtn: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignModalCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  assignModalConfirmBtn: {
    flex: 2,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignModalConfirmBtnDisabled: {
    backgroundColor: '#94A3B8',
    opacity: 0.7,
  },
  assignModalConfirmBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  assignModalBtnLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
