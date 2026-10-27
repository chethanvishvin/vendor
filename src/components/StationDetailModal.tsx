import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import { StationItem, CompletedStationItem, VendorProfile } from '../types';
import { InstallationPhotoGallery } from './InstallationPhotoGallery';
import { InstallationProofSection } from './InstallationProofSection';

interface StationDetailModalProps {
  visible: boolean;
  station: StationItem | CompletedStationItem | null;
  currentVendor?: VendorProfile;
  isPending?: boolean;
  onClose: () => void;
  onSubmissionSuccess?: () => void;
}

export const StationDetailModal: React.FC<StationDetailModalProps> = ({
  visible,
  station,
  currentVendor,
  isPending,
  onClose,
  onSubmissionSuccess,
}) => {
  if (!station) return null;

  const isWorker =
    currentVendor?.RoleId === 9 ||
    currentVendor?.userType === 'VendorWorker' ||
    Boolean(currentVendor?.VendorWorkerId) ||
    Boolean((currentVendor as any)?.WorkerId);

  const handleCall = (phoneNumber: string) => {
    if (!phoneNumber) return;
    const cleanNumber = phoneNumber.replace(/\s+/g, '');
    Linking.openURL(`tel:${cleanNumber}`).catch(() => {
      Alert.alert('Unable to place call', `Please dial ${phoneNumber}`);
    });
  };

  const handleOpenMaps = (lat: string, lng: string, name: string) => {
    if (!lat || !lng) {
      Alert.alert('Location unavailable', 'Coordinates not available for this station.');
      return;
    }
    const label = encodeURIComponent(name);
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open Google Maps.');
    });
  };

  const isCompleted = isPending !== undefined
    ? !isPending
    : Boolean('InstallationSubmissionId' in (station as any) || (station as any).files?.length > 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContent}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.voltagePill}>
                <Text style={styles.voltageText}>{station.VoltageClass} kV</Text>
              </View>
              <Text style={styles.stationName} numberOfLines={1}>
                {station.Station}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scrollArea}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}>
            
           {/* In-Charge Engineer Card */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>👤 In-Charge AE / JE Engineer</Text>
              </View>
              <View style={styles.engineerRow}>
                <View style={styles.engineerInfo}>
                  <Text style={styles.engineerName}>{station.InChangreAEJEname || 'N/A'}</Text>
                  <Text style={styles.engineerRole}>Assistant / Junior Engineer</Text>
                  <Text style={styles.engineerPhone}>
                    📞 {('ContactNumber' in station && station.ContactNumber) || ('StationContactNumber' in station && station.StationContactNumber) || 'No Phone'}
                  </Text>
                </View>
                {(('ContactNumber' in station && station.ContactNumber) || ('StationContactNumber' in station && station.StationContactNumber)) ? (
                  <TouchableOpacity
                    style={styles.callButton}
                    onPress={() =>
                      handleCall(
                        (('ContactNumber' in station && station.ContactNumber) ||
                          ('StationContactNumber' in station && station.StationContactNumber)) as string,
                      )
                    }
                    activeOpacity={0.8}>
                    <Text style={styles.callButtonText}>Call</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            {/* Hardware & Serial Numbers */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>⚡ Hardware & Equipment Serials</Text>
              </View>
              <View style={styles.gridRow}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Switch Serial No.</Text>
                  <Text style={styles.gridValue}>
                    {station.SwitchSerialNumber || 'Not Recorded'}
                  </Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridLabel}>Resilient Serial No.</Text>
                  <Text style={styles.gridValue}>
                    {station.ResilientSerialNumber || 'Not Recorded'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Dynamic Installation Proof & Photo Upload (For Pending Substation) */}
            {!isCompleted && currentVendor && (
              <InstallationProofSection
                station={station as StationItem}
                currentVendor={currentVendor}
                isWorker={isWorker}
                onSuccess={() => {
                  if (onSubmissionSuccess) {
                    onSubmissionSuccess();
                  }
                  onClose();
                }}
              />
            )}

            {/* Installation Verification & Uploaded Photos (For Completed Substation) */}
            {((station as any).files?.length > 0 || (station as any).InstallationCreatedByUserName) && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>✅ Installation Verification</Text>
                </View>
                {(station as any).InstallationCreatedByUserName ? (
                  <View style={styles.timelineItem}>
                    <Text style={styles.timelineLabel}>Installed By:</Text>
                    <Text style={styles.timelineValue}>
                      {(station as any).InstallationCreatedByUserName}
                    </Text>
                  </View>
                ) : null}
                {(station as any).InstallationCreatedAt ? (
                  <View style={styles.timelineItem}>
                    <Text style={styles.timelineLabel}>Installation Date:</Text>
                    <Text style={styles.timelineValue}>
                      {new Date((station as any).InstallationCreatedAt).toLocaleString()}
                    </Text>
                  </View>
                ) : null}
                <InstallationPhotoGallery
                  files={(station as any).files || []}
                  isWorker={isWorker}
                />
              </View>
            )}


            {/* Location & Territory */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>📍 Location & Substation Address</Text>
              </View>
              <Text style={styles.addressText}>{station.SubStationAddress}</Text>

              <View style={styles.territoryRow}>
                <Text style={styles.territoryItem}>
                  Zone: <Text style={styles.bold}>{station.Zone || 'N/A'}</Text>
                </Text>
                <Text style={styles.territoryItem}>
                  Circle: <Text style={styles.bold}>{station.Circle || 'N/A'}</Text>
                </Text>
              </View>
              <View style={styles.territoryRow}>
                <Text style={styles.territoryItem}>
                  Division: <Text style={styles.bold}>{station.Division || 'N/A'}</Text>
                </Text>
                <Text style={styles.territoryItem}>
                  Taluk: <Text style={styles.bold}>{station.Taluk || 'N/A'}</Text>
                </Text>
              </View>
              <View style={styles.territoryRow}>
                <Text style={styles.territoryItem}>
                  Pin Code: <Text style={styles.bold}>{station.PinCode || 'N/A'}</Text>
                </Text>
              </View>

              {/* Coordinates & Navigation */}
              <View style={styles.navRow}>
                <View style={styles.coordsWrap}>
                  <Text style={styles.coordsLabel}>GPS Coordinates:</Text>
                  <Text style={styles.coordsValue}>
                    {station.Latitude}, {station.Longitude}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.navButton}
                  onPress={() =>
                    handleOpenMaps(
                      station.Latitude,
                      station.Longitude,
                      `${station.Station} Substation`,
                    )
                  }
                  activeOpacity={0.8}>
                  <Text style={styles.navButtonText}>🗺️ Open Maps</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Guidance & Audit Timeline */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>🕒 Audit & Submission History</Text>
              </View>
              <View style={styles.timelineItem}>
                <Text style={styles.timelineLabel}>Field Visit Date:</Text>
                <Text style={styles.timelineValue}>
                  {station.VisitedAt
                    ? new Date(station.VisitedAt).toLocaleString()
                    : 'Pending visit'}
                </Text>
              </View>
              <View style={styles.timelineItem}>
                <Text style={styles.timelineLabel}>Submission Registered:</Text>
                <Text style={styles.timelineValue}>
                  {station.SubmissionCreatedAt
                    ? new Date(station.SubmissionCreatedAt).toLocaleString()
                    : 'N/A'}
                </Text>
              </View>
              {station.StationRemarks ? (
                <View style={styles.timelineItem}>
                  <Text style={styles.timelineLabel}>Station Remarks:</Text>
                  <Text style={styles.timelineValue}>{station.StationRemarks}</Text>
                </View>
              ) : null}
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Bottom Action */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={onClose}
              activeOpacity={0.8}>
              <Text style={styles.doneBtnText}>Close Details</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    minHeight: '60%',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  voltagePill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  voltageText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12,
  },
  stationName: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  statusBannerSuccess: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  statusBannerPending: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 12,
  },
  dotSuccess: {
    backgroundColor: '#16A34A',
  },
  dotPending: {
    backgroundColor: '#F59E0B',
  },
  statusBannerTextWrap: {
    flex: 1,
  },
  statusBannerTitle: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  statusBannerSub: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeader: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 6,
  },
  cardTitle: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  engineerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  engineerInfo: {
    flex: 1,
  },
  engineerName: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
  },
  engineerRole: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  engineerPhone: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  callButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  callButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  gridItem: {
    flex: 1,
  },
  gridLabel: {
    color: '#64748B',
    fontSize: 11,
    marginBottom: 2,
    fontWeight: '600',
  },
  gridValue: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  addressText: {
    color: '#334155',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },
  territoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  territoryItem: {
    color: '#64748B',
    fontSize: 12,
    flex: 1,
  },
  bold: {
    color: '#0F172A',
    fontWeight: '600',
  },
  navRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  coordsWrap: {
    flex: 1,
  },
  coordsLabel: {
    color: '#64748B',
    fontSize: 11,
  },
  coordsValue: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  navButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  navButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  timelineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  timelineLabel: {
    color: '#64748B',
    fontSize: 12,
  },
  timelineValue: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  doneBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  doneBtnText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 14,
  },
});
