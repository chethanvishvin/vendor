import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';
import { CompletedStationItem } from '../types';
import { InstallationPhotoGallery } from './InstallationPhotoGallery';

interface CompletedStationCardProps {
  item: CompletedStationItem;
  onPress?: () => void;
}

export const CompletedStationCard: React.FC<CompletedStationCardProps> = ({
  item,
  onPress,
}) => {
  const handleCall = (phoneNumber: string) => {
    if (!phoneNumber) return;
    const cleanNumber = phoneNumber.replace(/\s+/g, '');
    Linking.openURL(`tel:${cleanNumber}`).catch(() => {
      Alert.alert('Unable to place call', `Please dial ${phoneNumber}`);
    });
  };

  const handleOpenMaps = (lat: string, lng: string, name: string) => {
    if (!lat || !lng) {
      Alert.alert('Location unavailable', 'Coordinates not available.');
      return;
    }
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('Error', 'Unable to open Google Maps.');
    });
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return 'Completed';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  const isHighVoltage = item.VoltageClass === '220' || item.VoltageClass === '400';

  return (
    <View style={styles.cardContainer}>
      {/* Top Header */}
      <View style={styles.cardHeader}>
        <View style={styles.titleRow}>
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
              {item.VoltageClass} kV
            </Text>
          </View>
          <Text style={styles.stationName} numberOfLines={1}>
            {item.Station}
          </Text>
        </View>

        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>✓ Completed</Text>
        </View>
      </View>

      {/* Completion Details Banner */}
      <View style={styles.completionBanner}>
        <View style={styles.completionMeta}>
          <Text style={styles.completionLabel}>Installed By:</Text>
          <Text style={styles.completionValue}>
            {item.InstallationCreatedByUserName || 'Field Engineer'}
          </Text>
        </View>
        <View style={styles.completionMeta}>
          <Text style={styles.completionLabel}>Date:</Text>
          <Text style={styles.completionValue}>
            {formatDate(item.InstallationCreatedAt || item.VisitedAt)}
          </Text>
        </View>
      </View>

      {/* Location Details */}
      <View style={styles.locationSection}>
        {(item.Zone || item.Circle || item.Division) ? (
          <View style={styles.cardJurisdictionRow}>
            <Text style={styles.cardJurisdictionText} numberOfLines={1}>
              🌐 {[item.Zone, item.Circle, item.Division].filter(Boolean).join(' • ')}
            </Text>
          </View>
        ) : null}
        <Text style={styles.talukText}>
          📍 {item.Taluk || item.Division} • Pin: {item.PinCode}
        </Text>
        <Text style={styles.addressText} numberOfLines={2}>
          {item.SubStationAddress}
        </Text>
        {item.Latitude && item.Longitude ? (
          <TouchableOpacity
            style={styles.mapLinkBtn}
            onPress={() =>
              handleOpenMaps(item.Latitude, item.Longitude, item.Station)
            }
            activeOpacity={0.7}>
            <Text style={styles.mapLinkText}>🗺️ Open Location in Maps</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Hardware Serials Badge */}
      <View style={styles.hardwareRow}>
        <View style={styles.hardwareBadge}>
          <Text style={styles.hardwareLabel}>Switch S/N:</Text>
          <Text style={styles.hardwareValue} numberOfLines={1}>
            {item.SwitchSerialNumber || 'N/A'}
          </Text>
        </View>
        <View style={styles.hardwareBadge}>
          <Text style={styles.hardwareLabel}>Resilient S/N:</Text>
          <Text style={styles.hardwareValue} numberOfLines={1}>
            {item.ResilientSerialNumber || 'N/A'}
          </Text>
        </View>
      </View>

      {/* AE/JE Engineer Contact */}
      <View style={styles.engineerSection}>
        <View style={styles.engineerInfo}>
          <Text style={styles.engineerTitle}>AE/JE In-Charge:</Text>
          <Text style={styles.engineerName} numberOfLines={1}>
            {item.InChangreAEJEname || 'N/A'}
          </Text>
        </View>
        {item.StationContactNumber ? (
          <TouchableOpacity
            style={styles.callButton}
            onPress={() => handleCall(item.StationContactNumber)}
            activeOpacity={0.8}>
            <Text style={styles.callButtonText}>📞 Call AE/JE</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Installation Remarks */}
      {item.InstallationRemarks && item.InstallationRemarks.trim().length > 0 ? (
        <View style={styles.remarksBox}>
          <Text style={styles.remarksLabel}>Installation Remarks:</Text>
          <Text style={styles.remarksText}>{item.InstallationRemarks.trim()}</Text>
        </View>
      ) : null}

      {/* Installation Photos & Files Gallery */}
      <InstallationPhotoGallery files={item.files || []} />
    </View>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  voltageTag: {
    paddingHorizontal: 8,
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
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  statusPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  statusPillText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
  },
  completionBanner: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'space-between',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  completionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  completionLabel: {
    color: '#64748B',
    fontSize: 11,
  },
  completionValue: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '600',
  },
  locationSection: {
    marginBottom: 12,
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
  talukText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  addressText: {
    color: '#334155',
    fontSize: 12,
    lineHeight: 17,
  },
  mapLinkBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  mapLinkText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '600',
  },
  hardwareRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  hardwareBadge: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  hardwareLabel: {
    color: '#64748B',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  hardwareValue: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  engineerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  engineerInfo: {
    flex: 1,
    marginRight: 8,
  },
  engineerTitle: {
    color: '#64748B',
    fontSize: 10,
    textTransform: 'uppercase',
  },
  engineerName: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  callButton: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  callButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  remarksBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
  },
  remarksLabel: {
    color: '#64748B',
    fontSize: 10,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  remarksText: {
    color: '#334155',
    fontSize: 11,
    lineHeight: 16,
  },
});
