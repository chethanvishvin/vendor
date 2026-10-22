import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
  BackHandler,
  StatusBar,
} from 'react-native';
import { StationItem, CompletedStationItem, VendorProfile } from '../types';
import { InstallationPhotoGallery } from '../components/InstallationPhotoGallery';
import { InstallationProofSection } from '../components/InstallationProofSection';

interface StationDetailScreenProps {
  station: StationItem | CompletedStationItem;
  currentVendor?: VendorProfile;
  isPending?: boolean;
  onBack: () => void;
  onSubmissionSuccess: () => void;
}

export const StationDetailScreen: React.FC<StationDetailScreenProps> = ({
  station,
  currentVendor,
  isPending,
  onBack,
  onSubmissionSuccess,
}) => {
  // Handle Android hardware back button
  useEffect(() => {
    const backAction = () => {
      onBack();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction,
    );

    return () => backHandler.remove();
  }, [onBack]);

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

  const isHighVoltage = station.VoltageClass === '220' || station.VoltageClass === '400';

  return (
    <View style={styles.screenContainer}>
      <StatusBar barStyle="dark-content" />

      {/* Top App Bar */}
      <View style={styles.topAppBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          activeOpacity={0.7}>
          <Text style={styles.backButtonIcon}>←</Text>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.titleContainer}>
          <View
            style={[
              styles.voltageTag,
              isHighVoltage ? styles.voltageHigh : styles.voltageStandard,
            ]}>
            <Text
              style={[
                styles.voltageTagText,
                isHighVoltage ? styles.voltageTextHigh : styles.voltageTextStandard,
              ]}>
              {station.VoltageClass} kV
            </Text>
          </View>
          <Text style={styles.screenTitle} numberOfLines={1}>
            {station.Station}
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            isCompleted ? styles.statusPillDone : styles.statusPillPending,
          ]}>
          <Text
            style={[
              styles.statusPillText,
              isCompleted ? styles.statusTextDone : styles.statusTextPending,
            ]}>
            {isCompleted ? '✓ Done' : '⏳ Pending'}
          </Text>
        </View>
      </View>

      {/* Main Content ScrollView */}
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
            onSuccess={onSubmissionSuccess}
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
            <InstallationPhotoGallery files={(station as any).files || []} />
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

        {/* Bottom Back Button */}
        <TouchableOpacity
          style={styles.bottomBackBtn}
          onPress={onBack}
          activeOpacity={0.8}>
          <Text style={styles.bottomBackBtnText}>← Return to Substations List</Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topAppBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 3,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 4,
  },
  backButtonIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  backButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 10,
    gap: 6,
  },
  screenTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    flexShrink: 1,
  },
  voltageTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
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
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
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
    fontSize: 15,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 2,
  },
  engineerRole: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 4,
  },
  engineerPhone: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600',
  },
  callButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  callButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  gridItem: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  gridLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 2,
  },
  gridValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  addressText: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
    marginBottom: 12,
  },
  territoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  territoryItem: {
    fontSize: 12,
    color: '#64748B',
    flex: 1,
  },
  bold: {
    fontWeight: '700',
    color: '#1E293B',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  coordsWrap: {
    flex: 1,
  },
  coordsLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  coordsValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },
  navButton: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  navButtonText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  timelineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  timelineLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  timelineValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  bottomBackBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  bottomBackBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
});
