import React, { useState, useMemo, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import { StationItem, CompletedStationItem } from '../types';
import {
  DEFAULT_DWA_NO,
  DEFAULT_DWA_DATE,
  formatOfficeDescription,
  generateAnnexurePdf,
  downloadAnnexurePdf,
  shareAnnexurePdf,
  viewAnnexurePdf,
  printAnnexure,
  AnnexureOptions,
} from '../services/annexureService';

interface AnnexureModalProps {
  visible: boolean;
  station?: StationItem | CompletedStationItem | null;
  stations?: (StationItem | CompletedStationItem)[];
  onClose: () => void;
}

export const AnnexureModal: React.FC<AnnexureModalProps> = ({
  visible,
  station,
  stations,
  onClose,
}) => {
  const stationList = useMemo(() => {
    if (stations && stations.length > 0) return stations;
    if (station) return [station];
    return [];
  }, [stations, station]);

  const [currentStationIndex, setCurrentStationIndex] = useState(0);

  useEffect(() => {
    if (visible) {
      setCurrentStationIndex(0);
      setDownloadSuccessPath(null);
    }
  }, [visible]);

  const safeIndex = currentStationIndex < stationList.length ? currentStationIndex : 0;
  const activeStation = stationList[safeIndex];

  const defaultOfficeDescription = useMemo(() => {
    if (!activeStation) return '.....................................';
    return formatOfficeDescription(activeStation.SubStationAddress, activeStation.Station);
  }, [activeStation]);

  const [customDescriptions, setCustomDescriptions] = useState<Record<number, string>>({});
  const activeOfficeDescription = customDescriptions[safeIndex] ?? defaultOfficeDescription;

  const [dwaNo, setDwaNo] = useState(DEFAULT_DWA_NO);
  const [certDate, setCertDate] = useState(DEFAULT_DWA_DATE);
  const [showConfig, setShowConfig] = useState(false);

  const [isDownloading, setIsDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [downloadSuccessPath, setDownloadSuccessPath] = useState<string | null>(null);

  const isBatchMode = stationList.length > 1;

  if (stationList.length === 0) {
    return null;
  }

  const getOptions = (): AnnexureOptions => {
    if (isBatchMode) {
      return {
        substationName: `All_${stationList.length}_Pending_Stations`,
        stations: stationList.map((st, idx) => ({
          substationName: st.Station || `Station_${idx + 1}`,
          officeDescription: (customDescriptions[idx] ?? formatOfficeDescription(st.SubStationAddress, st.Station)).trim(),
          address: st.SubStationAddress || '',
          voltageClass: st.VoltageClass || '',
        })),
        dwaNo: dwaNo.trim() || DEFAULT_DWA_NO,
        date: certDate.trim() || DEFAULT_DWA_DATE,
      };
    }

    return {
      substationName: activeStation?.Station || 'Substation',
      officeDescription: activeOfficeDescription.trim(),
      dwaNo: dwaNo.trim() || DEFAULT_DWA_NO,
      date: certDate.trim() || DEFAULT_DWA_DATE,
      division: activeStation?.Division || '',
      circle: activeStation?.Circle || '',
    };
  };

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      setDownloadSuccessPath(null);
      const res = await downloadAnnexurePdf(getOptions());
      setDownloadSuccessPath(res.filePath);
      const alertMsg = isBatchMode
        ? `Combined Annexure-11 PDF (${stationList.length} pending substations) has been saved to your Downloads folder:\n\n${res.fileName}`
        : `Annexure-11 PDF has been saved to your Downloads folder:\n\n${res.fileName}`;
      Alert.alert(
        'Downloaded Successfully ✅',
        alertMsg,
        [
          { text: 'OK' },
          {
            text: 'Open PDF',
            onPress: () => handleViewPdf(),
          },
        ],
      );
    } catch (err: any) {
      Alert.alert('Download Failed', err?.message || 'Could not save PDF to Downloads.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    try {
      setIsSharing(true);
      await shareAnnexurePdf(getOptions());
    } catch (err: any) {
      Alert.alert('Share Failed', err?.message || 'Could not share Annexure-11 PDF.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleViewPdf = async () => {
    try {
      setIsViewing(true);
      await viewAnnexurePdf(getOptions());
    } catch (err: any) {
      Alert.alert('Unable to Open PDF', err?.message || 'Could not open PDF viewer.');
    } finally {
      setIsViewing(false);
    }
  };

  const handlePrint = async () => {
    try {
      setIsPrinting(true);
      await printAnnexure(getOptions());
    } catch (err: any) {
      Alert.alert('Print Failed', err?.message || 'Could not trigger print dialog.');
    } finally {
      setIsPrinting(false);
    }
  };

  const handleReset = () => {
    setCustomDescriptions(prev => {
      const next = { ...prev };
      delete next[safeIndex];
      return next;
    });
    setDwaNo(DEFAULT_DWA_NO);
    setCertDate(DEFAULT_DWA_DATE);
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
              <View style={[styles.headerBadge, isBatchMode && styles.headerBatchBadge]}>
                <Text style={[styles.headerBadgeText, isBatchMode && styles.headerBatchBadgeText]}>
                  {isBatchMode
                    ? `${stationList.length} Stations`
                    : activeStation?.VoltageClass
                      ? `${activeStation.VoltageClass} kV`
                      : 'KPTCL'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {isBatchMode ? `Annexure - 11 (${stationList.length} Pending)` : 'Annexure - 11 Certificate'}
                </Text>
                <Text style={styles.headerSubTitle} numberOfLines={1}>
                  {isBatchMode
                    ? `Single PDF with 1 page per station`
                    : `Work Completion Certificate for ${activeStation?.Station || 'Substation'}`}
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

          {/* Multi-Station Pagination Toolbar for Preview */}
          {isBatchMode && (
            <View style={styles.pagerBar}>
              <TouchableOpacity
                style={[styles.pagerNavBtn, safeIndex === 0 && styles.pagerNavBtnDisabled]}
                disabled={safeIndex === 0}
                onPress={() => setCurrentStationIndex(prev => Math.max(0, prev - 1))}
                activeOpacity={0.7}>
                <Text style={[styles.pagerNavBtnText, safeIndex === 0 && styles.pagerNavBtnTextDisabled]}>
                  ◀ Prev
                </Text>
              </TouchableOpacity>

              <View style={styles.pagerCenterInfo}>
                <Text style={styles.pagerPageCount}>
                  Page {safeIndex + 1} of {stationList.length}
                </Text>
                <Text style={styles.pagerStationName} numberOfLines={1}>
                  {activeStation?.Station}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.pagerNavBtn, safeIndex === stationList.length - 1 && styles.pagerNavBtnDisabled]}
                disabled={safeIndex === stationList.length - 1}
                onPress={() => setCurrentStationIndex(prev => Math.min(stationList.length - 1, prev + 1))}
                activeOpacity={0.7}>
                <Text style={[styles.pagerNavBtnText, safeIndex === stationList.length - 1 && styles.pagerNavBtnTextDisabled]}>
                  Next ▶
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Quick Options Bar */}
          <View style={styles.quickBar}>
            <TouchableOpacity
              style={styles.customizeToggle}
              onPress={() => setShowConfig(!showConfig)}
              activeOpacity={0.75}>
              <Text style={styles.customizeToggleIcon}>
                {showConfig ? '⚙️ Hide Field Inputs' : '✏️ Edit Certificate Fields'}
              </Text>
              <Text style={styles.customizeToggleArrow}>{showConfig ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resetButton}
              onPress={handleReset}
              activeOpacity={0.75}>
              <Text style={styles.resetButtonText}>Reset Defaults</Text>
            </TouchableOpacity>
          </View>

          {/* Collapsible Editable Inputs */}
          {showConfig && (
            <View style={styles.configCard}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  {isBatchMode
                    ? `Station Address & Bracket for Page ${safeIndex + 1} (${activeStation?.Station}):`
                    : 'Station Address & Station Name in Bracket:'}
                </Text>
                <TextInput
                  style={[styles.textInput, styles.multilineInput]}
                  value={activeOfficeDescription}
                  onChangeText={text => {
                    setCustomDescriptions(prev => ({
                      ...prev,
                      [safeIndex]: text,
                    }));
                  }}
                  placeholder="e.g. Office of the Assistant Engineer... (Chandra Layout Sub-Station)"
                  placeholderTextColor="#94A3B8"
                  multiline={true}
                  numberOfLines={3}
                />
                <Text style={styles.inputHint}>
                  Appears after "Sub: Work Completion Certificate for the office of "
                </Text>
              </View>

              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1.4 }]}>
                  <Text style={styles.inputLabel}>DWA No (Applies to all):</Text>
                  <TextInput
                    style={styles.textInput}
                    value={dwaNo}
                    onChangeText={setDwaNo}
                    placeholder="DWA No"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 0.8 }]}>
                  <Text style={styles.inputLabel}>Dated:</Text>
                  <TextInput
                    style={styles.textInput}
                    value={certDate}
                    onChangeText={setCertDate}
                    placeholder="Dated (e.g. 02 JUL 2026)"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>
            </View>
          )}

          {/* Success Download Notice */}
          {downloadSuccessPath && (
            <View style={styles.successNotice}>
              <Text style={styles.successNoticeText}>
                ✅ Saved: {downloadSuccessPath}
              </Text>
            </View>
          )}

          {/* Scrollable Paper Preview */}
          <ScrollView
            style={styles.previewScroll}
            contentContainerStyle={styles.previewContent}
            showsVerticalScrollIndicator={true}>
            <View style={styles.paperSheet}>
              {/* Document Header */}
              <Text style={styles.docTitle}>Annexure - 11</Text>
              <Text style={styles.docSubtitle}>
                Work Completion Certificate for Part-1 Portion
              </Text>
              <Text style={styles.docDescription}>
                Part-1: Implementation of Resilient Network Architecture across KPTCL Substations and
                the establishment of a Central Command Control Center at corporate office.
              </Text>

              <View style={styles.docDivider} />

              {/* Addressee (flush left) */}
              <View style={styles.addressBlock}>
                <Text style={styles.docBold}>To</Text>
                <Text style={styles.docBold}>The Superintending Engineer (IT),</Text>
                <Text style={styles.docBold}>Corporate Office, KPTCL,</Text>
                <Text style={styles.docBold}>Indhana Bhavan, Racecourse Road,</Text>
                <Text style={styles.docBold}>Bengaluru-09.</Text>
              </View>

              {/* Subject & Reference (flush left) */}
              <View style={styles.subjectBlock}>
                <Text style={styles.docSubjectText}>
                  <Text style={styles.docBold}>Sub: Work Completion Certificate for the office of </Text>
                  <Text style={styles.docBold}>{activeOfficeDescription}</Text>
                </Text>

                <Text style={styles.docRefText}>
                  <Text style={styles.docBold}>Ref:DWA No: </Text>
                  <Text style={styles.docBold}>{dwaNo}</Text>
                </Text>

                <Text style={styles.docRefText}>
                  <Text style={styles.docBold}>Dated: </Text>
                  <Text style={styles.docBold}>{certDate}</Text>
                </Text>
              </View>

              {/* Body */}
              <Text style={styles.docBodyIntro}>
                The firm have supplied the Bill of materials as required for Implementation of
                Resilient Network Architecture for KPTCL Substations
              </Text>

              {/* Clauses a & b */}
              <View style={styles.itemRow}>
                <Text style={styles.itemBullet}>a.</Text>
                <Text style={styles.itemText}>
                  The firm have successfully Implemented Resilient Network Architecture with Secured
                  Structured Cabling and LAN Networking along with necessary cables &amp; other
                  consumables as per Part -1 portion of Sub Total - C of Price Schedule clause 4
                </Text>
              </View>

              <View style={styles.itemRow}>
                <Text style={styles.itemBullet}>b.</Text>
                <Text style={styles.itemText}>
                  The firm have successfully installed, Tested and commissioned as per Part-1
                  portion of Sub Total - D of Price schedule clause 4
                </Text>
              </View>

              {/* Signature Block - ONLY Signature and Substation In charge / JE / AE */}
              <View style={styles.signatureBlock}>
                <Text style={styles.signatureTitle}>Signature</Text>
                <Text style={styles.signatureRole}>Substation In charge / JE / AE</Text>
              </View>
            </View>
          </ScrollView>

          {/* Sticky Bottom Actions */}
          <View style={styles.bottomActions}>
            <View style={styles.primaryActionsRow}>
              {/* Download PDF */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.downloadBtn]}
                onPress={handleDownload}
                disabled={isDownloading}
                activeOpacity={0.8}>
                {isDownloading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.actionBtnIcon}>📥</Text>
                    <Text style={styles.actionBtnText}>
                      {isBatchMode ? `Download Single PDF (${stationList.length} Pages)` : 'Download PDF'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Share PDF */}
              <TouchableOpacity
                style={[styles.actionBtn, styles.shareBtn]}
                onPress={handleShare}
                disabled={isSharing}
                activeOpacity={0.8}>
                {isSharing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.actionBtnIcon}>📤</Text>
                    <Text style={styles.actionBtnText}>
                      {isBatchMode ? `Share (${stationList.length} Pages)` : 'Share'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.secondaryActionsRow}>
              {/* View PDF */}
              <TouchableOpacity
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={handleViewPdf}
                disabled={isViewing}
                activeOpacity={0.8}>
                {isViewing ? (
                  <ActivityIndicator size="small" color="#1E293B" />
                ) : (
                  <Text style={styles.secondaryBtnText}>
                    {isBatchMode ? `👁️ View PDF (${stationList.length} Pages)` : '👁️ Open in PDF Viewer'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Print Dialog */}
              <TouchableOpacity
                style={[styles.secondaryBtn, { flex: 1 }]}
                onPress={handlePrint}
                disabled={isPrinting}
                activeOpacity={0.8}>
                {isPrinting ? (
                  <ActivityIndicator size="small" color="#1E293B" />
                ) : (
                  <Text style={styles.secondaryBtnText}>
                    {isBatchMode ? `🖨️ Print (${stationList.length} Pages)` : '🖨️ Print / Save'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
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
    maxHeight: '94%',
    minHeight: '80%',
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
  headerBatchBadge: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  headerBadgeText: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '700',
  },
  headerBatchBadgeText: {
    color: '#15803D',
  },
  pagerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  pagerNavBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  pagerNavBtnDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    opacity: 0.5,
  },
  pagerNavBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563EB',
  },
  pagerNavBtnTextDisabled: {
    color: '#94A3B8',
  },
  pagerCenterInfo: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 8,
  },
  pagerPageCount: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pagerStationName: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubTitle: {
    fontSize: 12,
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
    fontSize: 14,
    color: '#475569',
    fontWeight: '700',
  },
  quickBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F1F5F9',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  customizeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customizeToggleIcon: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  customizeToggleArrow: {
    fontSize: 10,
    color: '#2563EB',
  },
  resetButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  resetButtonText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  configCard: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 10,
  },
  inputGroup: {
    gap: 4,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: '#0F172A',
  },
  multilineInput: {
    minHeight: 64,
    textAlignVertical: 'top',
    lineHeight: 18,
  },
  inputHint: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },
  successNotice: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 8,
  },
  successNoticeText: {
    fontSize: 12,
    color: '#065F46',
    fontWeight: '600',
  },
  previewScroll: {
    flex: 1,
  },
  previewContent: {
    padding: 14,
    alignItems: 'center',
  },
  paperSheet: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    padding: 22,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  docTitle: {
    fontFamily: 'serif',
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#000000',
    marginBottom: 4,
  },
  docSubtitle: {
    fontFamily: 'serif',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#000000',
    marginBottom: 4,
  },
  docDescription: {
    fontFamily: 'serif',
    fontSize: 11.5,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#000000',
    lineHeight: 16,
    marginBottom: 16,
  },
  docDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginBottom: 16,
  },
  addressBlock: {
    marginBottom: 16,
    gap: 2,
  },
  docBold: {
    fontFamily: 'serif',
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  docNormal: {
    fontFamily: 'serif',
    fontSize: 12,
    color: '#000000',
  },
  subjectBlock: {
    marginBottom: 16,
    gap: 4,
  },
  docSubjectText: {
    lineHeight: 18,
    marginBottom: 2,
  },
  docRefText: {
    lineHeight: 18,
  },
  docBodyIntro: {
    fontFamily: 'serif',
    fontSize: 12,
    color: '#000000',
    lineHeight: 17,
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    marginLeft: 14,
    marginBottom: 10,
    gap: 6,
  },
  itemBullet: {
    fontFamily: 'serif',
    fontSize: 12,
    color: '#000000',
    fontWeight: 'bold',
    width: 16,
  },
  itemText: {
    flex: 1,
    fontFamily: 'serif',
    fontSize: 12,
    color: '#000000',
    lineHeight: 17,
  },
  signatureBlock: {
    marginTop: 40,
    gap: 2,
  },
  signatureTitle: {
    fontFamily: 'serif',
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  signatureRole: {
    fontFamily: 'serif',
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000',
  },
  bottomActions: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    padding: 12,
    gap: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 4,
  },
  primaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 6,
  },
  downloadBtn: {
    backgroundColor: '#2563EB',
  },
  shareBtn: {
    backgroundColor: '#059669',
  },
  actionBtnIcon: {
    fontSize: 15,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryBtn: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
});
