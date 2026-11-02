import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StatusBar,
  ScrollView,
} from 'react-native';
import {
  KNOWN_SWITCH_FILES,
  SwitchFileInfo,
  getSwitchFilesInfo,
  downloadSwitchFile,
  shareSwitchFile,
  downloadAllSwitchFiles,
  shareAllSwitchFiles,
} from '../services/switchFilesService';

interface SwitchFilesModalProps {
  visible: boolean;
  onClose: () => void;
}

export const SwitchFilesModal: React.FC<SwitchFilesModalProps> = ({
  visible,
  onClose,
}) => {
  const [files, setFiles] = useState<SwitchFileInfo[]>(KNOWN_SWITCH_FILES);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      getSwitchFilesInfo().then(setFiles).catch(() => {});
    }
  }, [visible]);

  const handleDownloadSingle = async (fileName: string) => {
    try {
      setLoadingAction(`download_${fileName}`);
      const res = await downloadSwitchFile(fileName);
      Alert.alert(
        'Downloaded Successfully ✅',
        `The file "${res.fileName}" has been saved directly to your Downloads folder.\n\nPath: ${res.filePath}`,
        [{ text: 'OK' }],
      );
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || `Could not save ${fileName} to Downloads.`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleShareSingle = async (fileName: string) => {
    try {
      setLoadingAction(`share_${fileName}`);
      await shareSwitchFile(fileName);
    } catch (err: any) {
      Alert.alert('Share Failed', err?.message || `Could not share ${fileName}.`);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDownloadAll = async () => {
    try {
      setLoadingAction('download_all');
      const res = await downloadAllSwitchFiles();
      Alert.alert(
        'All Files Downloaded ✅',
        `Both switch deployment files (switchfirmware.imag & switchconfig.cfg) have been saved to your Downloads folder.`,
        [{ text: 'OK' }],
      );
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || 'Could not download switch files.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleShareAll = async () => {
    try {
      setLoadingAction('share_all');
      await shareAllSwitchFiles();
    } catch (err: any) {
      Alert.alert('Share Failed', err?.message || 'Could not share switch files.');
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <StatusBar barStyle="light-content" />
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>KPTCL Switch Tools</Text>
              </View>
              <View>
                <Text style={styles.headerTitle}>Switch Firmware &amp; Config</Text>
                <Text style={styles.headerSubTitle}>
                  Bundled installation &amp; deployment files
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Info Notice Banner */}
          <View style={styles.noticeBox}>
            <Text style={styles.noticeIcon}>ℹ️</Text>
            <Text style={styles.noticeText}>
              Download or share these files to your device or field laptop for switch configuration.
            </Text>
          </View>

          {/* Files List */}
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {files.map(file => {
              const isDownloading = loadingAction === `download_${file.fileName}`;
              const isSharing = loadingAction === `share_${file.fileName}`;

              return (
                <View key={file.fileName} style={styles.fileCard}>
                  <View style={styles.fileCardHeader}>
                    <View style={styles.fileIconWrap}>
                      <Text style={styles.fileIcon}>{file.icon}</Text>
                    </View>
                    <View style={styles.fileInfo}>
                      <View style={styles.fileNameRow}>
                        <Text style={styles.fileName}>{file.fileName}</Text>
                        <View style={styles.fileBadge}>
                          <Text style={styles.fileBadgeText}>{file.badge}</Text>
                        </View>
                      </View>
                      <Text style={styles.fileDisplayName}>{file.displayName}</Text>
                      {Boolean(file.sizeFormatted) && (
                        <Text style={styles.fileSizeText}>Size: {file.sizeFormatted}</Text>
                      )}
                    </View>
                  </View>

                  <Text style={styles.fileDescription}>{file.description}</Text>

                  {/* Direct Actions: Download & Share */}
                  <View style={styles.fileActionsRow}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.downloadBtn]}
                      onPress={() => handleDownloadSingle(file.fileName)}
                      disabled={Boolean(loadingAction)}
                      activeOpacity={0.8}>
                      {isDownloading ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Text style={styles.actionBtnIcon}>📥</Text>
                          <Text style={styles.actionBtnText}>Download</Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.actionBtn, styles.shareBtn]}
                      onPress={() => handleShareSingle(file.fileName)}
                      disabled={Boolean(loadingAction)}
                      activeOpacity={0.8}>
                      {isSharing ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Text style={styles.actionBtnIcon}>📤</Text>
                          <Text style={styles.actionBtnText}>Share</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {/* Bottom Batch Actions */}
          <View style={styles.bottomActions}>
            <TouchableOpacity
              style={[styles.batchBtn, styles.batchDownloadBtn]}
              onPress={handleDownloadAll}
              disabled={Boolean(loadingAction)}
              activeOpacity={0.85}>
              {loadingAction === 'download_all' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.batchBtnIcon}>📥</Text>
                  <Text style={styles.batchBtnText}>Download Both Files</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.batchBtn, styles.batchShareBtn]}
              onPress={handleShareAll}
              disabled={Boolean(loadingAction)}
              activeOpacity={0.85}>
              {loadingAction === 'share_all' ? (
                <ActivityIndicator size="small" color="#0F172A" />
              ) : (
                <>
                  <Text style={styles.batchBtnIcon}>📤</Text>
                  <Text style={styles.batchShareBtnText}>Share Both</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    minHeight: '60%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerBadge: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  headerBadgeText: {
    color: '#1D4ED8',
    fontSize: 10.5,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubTitle: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderBottomWidth: 1,
    borderBottomColor: '#DBEAFE',
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 8,
  },
  noticeIcon: {
    fontSize: 14,
  },
  noticeText: {
    fontSize: 11.5,
    color: '#1E40AF',
    lineHeight: 16,
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  fileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  fileCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  fileIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileIcon: {
    fontSize: 20,
  },
  fileInfo: {
    flex: 1,
  },
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  fileName: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
    fontFamily: 'monospace',
  },
  fileBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  fileBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#475569',
  },
  fileDisplayName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  fileSizeText: {
    fontSize: 10.5,
    color: '#059669',
    fontWeight: '700',
    marginTop: 2,
  },
  fileDescription: {
    fontSize: 11.5,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 12,
  },
  fileActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  downloadBtn: {
    backgroundColor: '#2563EB',
  },
  shareBtn: {
    backgroundColor: '#059669',
  },
  actionBtnIcon: {
    fontSize: 14,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12.5,
  },
  bottomActions: {
    flexDirection: 'row',
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 10,
  },
  batchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  batchDownloadBtn: {
    backgroundColor: '#1E293B',
  },
  batchShareBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  batchBtnIcon: {
    fontSize: 14,
  },
  batchBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  batchShareBtnText: {
    color: '#1E293B',
    fontSize: 12.5,
    fontWeight: '700',
  },
});
