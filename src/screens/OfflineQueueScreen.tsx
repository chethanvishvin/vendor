import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
  StatusBar,
  ToastAndroid,
  Platform,
} from 'react-native';
import {
  OfflineSubmissionItem,
  getOfflineSubmissions,
  syncSingleOfflineSubmission,
  syncAllOfflineSubmissions,
  deleteOfflineSubmission,
  addOfflineQueueListener,
} from '../db/sqliteService';

interface OfflineQueueScreenProps {
  vendorId?: number;
  onBack: () => void;
  onSyncComplete?: () => void;
}

export const OfflineQueueScreen: React.FC<OfflineQueueScreenProps> = ({
  vendorId,
  onBack,
  onSyncComplete,
}) => {
  const [submissions, setSubmissions] = useState<OfflineSubmissionItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncingAll, setIsSyncingAll] = useState<boolean>(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const isSyncingRef = useRef<boolean>(false);

  const loadSubmissions = useCallback(async () => {
    try {
      const items = await getOfflineSubmissions(vendorId);
      setSubmissions(items);
    } catch (err) {
      console.error('Failed to load offline submissions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    loadSubmissions();
    const unsub = addOfflineQueueListener(() => {
      loadSubmissions();
    });
    return unsub;
  }, [loadSubmissions]);

  const handleSyncSingle = async (item: OfflineSubmissionItem) => {
    if (isSyncingRef.current || syncingId !== null || isSyncingAll) {
      console.log('Sync already in progress, ignoring duplicate tap.');
      return;
    }
    isSyncingRef.current = true;
    setSyncingId(item.id);
    try {
      const result = await syncSingleOfflineSubmission(item);
      if (result.success) {
        if (Platform.OS === 'android') {
          ToastAndroid.show(
            `✅ Synced ${item.stationName} proof to RNA service!`,
            ToastAndroid.SHORT,
          );
        }
        await loadSubmissions();
        if (onSyncComplete) onSyncComplete();
      } else {
        Alert.alert('Sync Failed', result.error || 'Network error occurred while syncing.');
        await loadSubmissions();
      }
    } catch (err: any) {
      Alert.alert('Sync Error', err.message || 'Unable to sync submission.');
      await loadSubmissions();
    } finally {
      setSyncingId(null);
      isSyncingRef.current = false;
    }
  };

  const handleSyncAll = async () => {
    if (isSyncingRef.current || isSyncingAll || submissions.length === 0) {
      console.log('SyncAll already in progress or empty queue, ignoring duplicate tap.');
      return;
    }
    isSyncingRef.current = true;
    setIsSyncingAll(true);
    try {
      const result = await syncAllOfflineSubmissions(vendorId);
      if (Platform.OS === 'android') {
        ToastAndroid.show(
          `☁️ Sync completed: ${result.synced} succeeded, ${result.failed} failed`,
          ToastAndroid.LONG,
        );
      }
      await loadSubmissions();
      if (onSyncComplete) onSyncComplete();
    } catch (err: any) {
      Alert.alert('Sync Error', err.message || 'Error syncing submissions.');
    } finally {
      setIsSyncingAll(false);
      isSyncingRef.current = false;
    }
  };

  const handleDelete = (item: OfflineSubmissionItem) => {
    Alert.alert(
      'Discard Offline Submission?',
      `Are you sure you want to delete the pending proof for "${item.stationName}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteOfflineSubmission(item.id);
            await loadSubmissions();
            if (Platform.OS === 'android') {
              ToastAndroid.show('Submission discarded', ToastAndroid.SHORT);
            }
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: OfflineSubmissionItem }) => {
    const isThisSyncing = syncingId === item.id || (isSyncingAll && item.status === 'syncing');

    return (
      <View style={styles.card}>
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={styles.stationTitleRow}>
            {item.voltageClass ? (
              <View style={styles.voltageBadge}>
                <Text style={styles.voltageBadgeText}>{item.voltageClass} kV</Text>
              </View>
            ) : null}
            <Text style={styles.stationTitle} numberOfLines={1}>
              {item.stationName}
            </Text>
          </View>

          <View
            style={[
              styles.statusPill,
              item.status === 'failed'
                ? styles.statusPillFailed
                : item.status === 'syncing' || isThisSyncing
                  ? styles.statusPillSyncing
                  : styles.statusPillPending,
            ]}>
            <Text
              style={[
                styles.statusPillText,
                item.status === 'failed'
                  ? styles.statusTextFailed
                  : item.status === 'syncing' || isThisSyncing
                    ? styles.statusTextSyncing
                    : styles.statusTextPending,
              ]}>
              {isThisSyncing
                ? '🔄 Syncing...'
                : item.status === 'failed'
                  ? '⚠️ Failed'
                  : '⏳ Pending Sync'}
            </Text>
          </View>
        </View>

        {/* Timestamp & User */}
        <Text style={styles.timestampText}>
          Saved: {new Date(item.createdAt).toLocaleString()} • ExcelDataId #{item.excelDataId}
          {item.vendorWorkerId
            ? ` • 👷 Worker #${item.vendorWorkerId} (${item.createdByUserName})`
            : ` • 👤 By ${item.createdByUserName}`}
        </Text>

        {/* Error notice if failed */}
        {item.errorMessage ? (
          <View style={styles.errorNotice}>
            <Text style={styles.errorNoticeText}>⚠️ {item.errorMessage}</Text>
          </View>
        ) : null}

        {/* Remarks */}
        {item.remarks ? (
          <View style={styles.remarksBox}>
            <Text style={styles.remarksLabel}>Remarks:</Text>
            <Text style={styles.remarksText}>{item.remarks}</Text>
          </View>
        ) : null}

        {/* Hardware & Serials Details */}
        {(item.switchSerialNumber || item.resilientSerialNumber || item.switchFirmwareNumber || item.routeStationStatusId) ? (
          <View style={styles.hardwareBox}>
            <Text style={styles.hardwareTitle}>⚡ Hardware &amp; Submission Specs:</Text>
            <View style={styles.hardwareGrid}>
              {item.switchSerialNumber ? (
                <View style={styles.hardwareCol}>
                  <Text style={styles.hardwareColLabel}>Switch S/N</Text>
                  <Text style={styles.hardwareColVal} numberOfLines={1}>{item.switchSerialNumber}</Text>
                </View>
              ) : null}
              {item.resilientSerialNumber ? (
                <View style={styles.hardwareCol}>
                  <Text style={styles.hardwareColLabel}>Resilient S/N</Text>
                  <Text style={styles.hardwareColVal} numberOfLines={1}>{item.resilientSerialNumber}</Text>
                </View>
              ) : null}
              {item.switchFirmwareNumber ? (
                <View style={styles.hardwareCol}>
                  <Text style={styles.hardwareColLabel}>Switch FW</Text>
                  <Text style={styles.hardwareColVal} numberOfLines={1}>{item.switchFirmwareNumber}</Text>
                </View>
              ) : null}
              {item.routeStationStatusId ? (
                <View style={styles.hardwareCol}>
                  <Text style={styles.hardwareColLabel}>Route Status</Text>
                  <Text style={styles.hardwareColVal} numberOfLines={1}>#{item.routeStationStatusId}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Photo Previews */}
        <View style={styles.photosSection}>
          <Text style={styles.photosCountTitle}>
            📸 {item.files.length} Photo{item.files.length !== 1 ? 's' : ''} Stored:
          </Text>
          <View style={styles.thumbnailsRow}>
            {item.files.map((file, idx) => (
              <View key={idx} style={styles.thumbWrapper}>
                <Image source={{ uri: file.uri }} style={styles.thumbnail} />
                <View style={styles.thumbLabel}>
                  <Text style={styles.thumbLabelText} numberOfLines={1}>
                    {file.fileTypeName || `#${file.fileTypeId}`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.syncBtn, isThisSyncing && styles.btnDisabled]}
            onPress={() => handleSyncSingle(item)}
            disabled={isThisSyncing || isSyncingAll}
            activeOpacity={0.8}>
            {isThisSyncing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.syncBtnText}>⚡ Trigger Sync Now</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item)}
            disabled={isThisSyncing || isSyncingAll}
            activeOpacity={0.8}>
            <Text style={styles.deleteBtnText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screenContainer}>
      <StatusBar barStyle="dark-content" />

      {/* Top Header */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backButtonIcon}>←</Text>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.titleWrap}>
          <Text style={styles.screenTitle}>Offline Submissions Queue</Text>
          <Text style={styles.screenSub}>
            {submissions.length} item{submissions.length !== 1 ? 's' : ''} stored in SQLite
          </Text>
        </View>

        {submissions.length > 0 ? (
          <TouchableOpacity
            style={[styles.syncAllBtn, isSyncingAll && styles.btnDisabled]}
            onPress={handleSyncAll}
            disabled={isSyncingAll}
            activeOpacity={0.8}>
            {isSyncingAll ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.syncAllBtnText}>⚡ Sync All</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 60 }} />
        )}
      </View>

      {/* Main Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0284C7" />
          <Text style={styles.loadingText}>Reading stored queue from SQLite...</Text>
        </View>
      ) : submissions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>Queue is Empty</Text>
          <Text style={styles.emptySub}>
            All installation proofs are currently synchronized with the RNA service cloud.
          </Text>
          <Text style={styles.emptyHint}>
            When you submit proof while offline, it will be safely queued in the SQLite database and listed here.
          </Text>
          <TouchableOpacity style={styles.returnBtn} onPress={onBack}>
            <Text style={styles.returnBtnText}>← Return to Substations</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={submissions}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 10,
  },
  backButtonIcon: {
    fontSize: 18,
    color: '#0284C7',
    fontWeight: '700',
    marginRight: 4,
  },
  backButtonText: {
    fontSize: 14,
    color: '#0284C7',
    fontWeight: '600',
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  screenTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  screenSub: {
    fontSize: 11,
    color: '#64748B',
  },
  syncAllBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  syncAllBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  listContent: {
    padding: 14,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
    marginRight: 8,
  },
  voltageBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  voltageBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  stationTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillPending: {
    backgroundColor: '#FEF3C7',
  },
  statusPillSyncing: {
    backgroundColor: '#E0F2FE',
  },
  statusPillFailed: {
    backgroundColor: '#FEE2E2',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextPending: {
    color: '#B45309',
  },
  statusTextSyncing: {
    color: '#0369A1',
  },
  statusTextFailed: {
    color: '#B91C1C',
  },
  timestampText: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 8,
  },
  errorNotice: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  errorNoticeText: {
    fontSize: 11,
    color: '#B91C1C',
    fontWeight: '500',
  },
  remarksBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  remarksLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 2,
  },
  remarksText: {
    fontSize: 12,
    color: '#1E293B',
    lineHeight: 16,
  },
  hardwareBox: {
    backgroundColor: '#F0F9FF',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  hardwareTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369A1',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hardwareGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hardwareCol: {
    minWidth: '45%',
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0F2FE',
  },
  hardwareColLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '600',
  },
  hardwareColVal: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '700',
    marginTop: 1,
  },
  photosSection: {
    marginBottom: 12,
  },
  photosCountTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  thumbnailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  thumbWrapper: {
    alignItems: 'center',
    width: 68,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  thumbLabel: {
    marginTop: 2,
    maxWidth: 64,
  },
  thumbLabelText: {
    fontSize: 9.5,
    color: '#64748B',
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  syncBtn: {
    flex: 1,
    backgroundColor: '#10B981',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  deleteBtn: {
    backgroundColor: '#FEE2E2',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  deleteBtnText: {
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 13,
    color: '#64748B',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyIcon: {
    fontSize: 54,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 17,
    marginBottom: 20,
  },
  returnBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  returnBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
