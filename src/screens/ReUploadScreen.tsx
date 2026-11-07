import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  Image,
  Modal,
  ScrollView,
  Platform,
  PermissionsAndroid,
  Dimensions,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Geolocation from 'react-native-geolocation-service';
import Marker, { Position, ImageFormat } from 'react-native-image-marker';
import { apiService, clearInstallationImageCache } from '../api/apiService';
import NetInfo from '@react-native-community/netinfo';
import {
  VendorProfile,
  CompletedStationItem,
  CompletedStationFile,
} from '../types';
import { ensureFileUri } from '../db/sqliteService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ReUploadScreenProps {
  currentVendor: VendorProfile;
  isWorker?: boolean;
  initialStationId?: number | null;
  onBack: () => void;
}

interface GeoTag {
  latitude: number;
  longitude: number;
  address: string;
  capturedAt: string;
}

// Reverse geocoding helper with safe timeout
const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'VendorProofApp/1.0',
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!response.ok) throw new Error('Geocode failed');
    const data = await response.json();
    const addr = data.address;
    if (!addr) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const parts: string[] = [];
    if (addr.road || addr.street) parts.push(addr.road || addr.street);
    if (addr.suburb || addr.neighbourhood) parts.push(addr.suburb || addr.neighbourhood);
    if (addr.city || addr.town || addr.village) parts.push(addr.city || addr.town || addr.village);
    if (addr.state) parts.push(addr.state);
    if (addr.postcode) parts.push(addr.postcode);
    return parts.length > 0 ? parts.join(', ') : (data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`);
  } catch {
    clearTimeout(timer);
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
};

const formatDateTime = (date: Date): string => {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = date.getDate().toString().padStart(2, '0');
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  let h = date.getHours();
  const min = date.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${d} ${m} ${y}  ${h}:${min} ${ampm}`;
};

const stampGeoTag = async (
  imageUri: string,
  geoTag: GeoTag,
  isLarge = false,
): Promise<string> => {
  try {
    const coordStr = `${geoTag.latitude.toFixed(5)}, ${geoTag.longitude.toFixed(5)}`;
    const addrStr =
      geoTag.address.length > 80 ? geoTag.address.substring(0, 80) + '...' : geoTag.address;
    const inputUri = ensureFileUri(imageUri);

    const stampText = [
      `Location: ${addrStr}`,
      `GPS: ${coordStr}`,
      `Time: ${geoTag.capturedAt}`,
    ].join('\n');

    const result = await Marker.markText({
      backgroundImage: {
        src: { uri: inputUri },
        scale: 1,
      },
      watermarkTexts: [
        {
          text: stampText,
          position: { position: Position.bottomLeft, X: 16, Y: 16 },
          style: {
            color: '#FFFFFF',
            fontSize: 32,
            fontSizeRatio: 0.030,
            bold: true,
            maxWidth: '92%',
            shadowStyle: { dx: 1, dy: 1, radius: 3, color: '#000000' },
            textBackgroundStyle: {
              paddingX: 14,
              paddingY: 10,
              color: '#000000E6',
              cornerRadius: { all: { x: 8, y: 8 } },
            },
          },
        },
      ],
      filename: `reupload_geotagged_${Date.now()}`,
      saveFormat: ImageFormat.jpg,
      maxSize: isLarge ? 1024 : 1280,
      quality: isLarge ? 55 : 65,
    });

    return result?.uri ? ensureFileUri(result.uri) : inputUri;
  } catch (err) {
    console.warn('GeoTag stamping failed, using original:', err);
    return ensureFileUri(imageUri);
  }
};

// Sub-component: Photo Thumbnail with async image loading
const ReUploadPhotoThumbnail: React.FC<{
  file: CompletedStationFile;
  onPress: (uri: string) => void;
  onReplace: () => void;
}> = ({ file, onPress, onReplace }) => {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setHasError(false);

    apiService
      .viewInstallationSubmissionFile(file.installationSubmissionFileId, file.fileName)
      .then(uri => {
        if (isMounted) {
          setImageUri(uri);
          setIsLoading(false);
        }
      })
      .catch(err => {
        console.warn('Failed to load photo:', file.installationSubmissionFileId, err);
        if (isMounted) {
          setHasError(true);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [file.installationSubmissionFileId, file.fileName]);

  return (
    <View style={styles.photoItemCard}>
      <TouchableOpacity
        style={styles.photoThumbTouch}
        activeOpacity={0.8}
        onPress={() => imageUri && onPress(imageUri)}
        disabled={isLoading || hasError || !imageUri}>
        <View style={styles.photoThumbWrap}>
          {isLoading ? (
            <View style={styles.photoLoadingBox}>
              <ActivityIndicator size="small" color="#2563EB" />
              <Text style={styles.photoLoadingText}>Loading...</Text>
            </View>
          ) : hasError || !imageUri ? (
            <View style={styles.photoErrorBox}>
              <Text style={styles.photoErrorIcon}>⚠️</Text>
              <Text style={styles.photoErrorText}>Load Error</Text>
            </View>
          ) : (
            <Image source={{ uri: imageUri }} style={styles.photoImg} resizeMode="cover" />
          )}

          <View style={styles.fileTypeBadge}>
            <Text style={styles.fileTypeBadgeText} numberOfLines={1}>
              ID #{file.installationSubmissionFileId}
            </Text>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.photoItemMeta}>
        <Text style={styles.photoFileName} numberOfLines={1}>
          {file.fileName || `File #${file.installationSubmissionFileId}`}
        </Text>

        <TouchableOpacity
          style={styles.replaceBtn}
          activeOpacity={0.8}
          onPress={onReplace}>
          <Text style={styles.replaceBtnIcon}>🔄</Text>
          <Text style={styles.replaceBtnText}>Replace Photo</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export const ReUploadScreen: React.FC<ReUploadScreenProps> = ({
  currentVendor,
  isWorker = false,
  initialStationId = null,
  onBack,
}) => {
  const activeWorkerId =
    currentVendor.VendorWorkerId || (currentVendor as any).WorkerId || null;

  const [stations, setStations] = useState<CompletedStationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Search & Voltage Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedVoltage, setSelectedVoltage] = useState<string>('ALL');

  // Accordion state: set of expanded station IDs
  const [expandedStationIds, setExpandedStationIds] = useState<Set<number>>(
    new Set(initialStationId ? [initialStationId] : []),
  );

  // Modal: Full screen photo view
  const [viewingPhoto, setViewingPhoto] = useState<{
    uri: string;
    file: CompletedStationFile;
    station: CompletedStationItem;
  } | null>(null);

  // Modal: Single photo replacement
  const [replacingPhoto, setReplacingPhoto] = useState<{
    file: CompletedStationFile;
    station: CompletedStationItem;
  } | null>(null);

  const [replacementUri, setReplacementUri] = useState<string | null>(null);
  const [replacementGeoTag, setReplacementGeoTag] = useState<GeoTag | null>(null);
  const [replacementRemarks, setReplacementRemarks] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Fetch completed stations from apkfetchCompletedStation
  const fetchCompletedStations = useCallback(
    async (showLoadingSpinner = true) => {
      if (showLoadingSpinner) setIsLoading(true);
      setErrorMessage(null);

      try {
        const vendorId = currentVendor.VendorId;
        const result = await apiService.apkfetchCompletedStation(
          vendorId,
          1,
          isWorker ? activeWorkerId : null,
        );

        setStations(result);

        if (initialStationId && result.some(s => s.VendorStationAssignmentId === initialStationId)) {
          setExpandedStationIds(prev => new Set([...prev, initialStationId]));
        } else if (result.length > 0 && expandedStationIds.size === 0) {
          // Auto-expand first station by default for great UX
          setExpandedStationIds(new Set([result[0].VendorStationAssignmentId]));
        }
      } catch (err: any) {
        console.warn('Failed to fetch completed stations for re-upload:', err);
        setErrorMessage(err.message || 'Unable to load completed stations from server.');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [currentVendor.VendorId, isWorker, activeWorkerId, initialStationId],
  );

  useEffect(() => {
    fetchCompletedStations();
  }, [fetchCompletedStations]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchCompletedStations(false);
  };

  const toggleExpand = (stationId: number) => {
    setExpandedStationIds(prev => {
      const next = new Set(prev);
      if (next.has(stationId)) {
        next.delete(stationId);
      } else {
        next.add(stationId);
      }
      return next;
    });
  };

  const handleCall = (phoneNumber?: string | null) => {
    if (!phoneNumber) return;
    const cleanNumber = phoneNumber.replace(/\s+/g, '');
    Linking.openURL(`tel:${cleanNumber}`).catch(() => {
      Alert.alert('Unable to place call', `Please dial ${phoneNumber}`);
    });
  };

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Access Needed',
          message: 'Camera permission is required to capture replacement photo.',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  const requestLocationPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Access',
          message: 'Location access is required to embed GPS coordinates on replacement photos.',
          buttonNegative: 'Skip',
          buttonPositive: 'Allow',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  const getCurrentLocation = (): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        err => {
          console.warn('Geolocation error:', err.message);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  };

  // Capture live photo for replacement
  const handleLaunchCamera = async () => {
    const hasCam = await requestCameraPermission();
    if (!hasCam) {
      Alert.alert('Permission Denied', 'Camera permission is required.');
      return;
    }

    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.7,
        maxWidth: 1280,
        maxHeight: 1280,
        saveToPhotos: false,
      },
      async response => {
        if (response.didCancel) return;
        if (response.errorMessage) {
          Alert.alert('Camera Error', response.errorMessage);
          return;
        }

        if (response.assets && response.assets.length > 0) {
          const asset = response.assets[0];
          if (!asset.uri) return;

          setIsCapturing(true);
          try {
            const rawUri = ensureFileUri(asset.uri);
            const isLarge = (asset.fileSize || 0) > 850 * 1024;
            let finalUri = rawUri;
            let geoTag: GeoTag | null = null;

            const hasLoc = await requestLocationPermission();
            if (hasLoc) {
              const coords = await getCurrentLocation();
              if (coords) {
                const capturedAt = formatDateTime(new Date());
                const address = await reverseGeocode(coords.latitude, coords.longitude);
                geoTag = { latitude: coords.latitude, longitude: coords.longitude, address, capturedAt };
                finalUri = await stampGeoTag(rawUri, geoTag, isLarge);
              }
            }

            setReplacementUri(finalUri);
            setReplacementGeoTag(geoTag);
          } finally {
            setIsCapturing(false);
          }
        }
      },
    );
  };

  // Pick replacement photo from device gallery
  const handleLaunchGallery = async () => {
    launchImageLibrary(
      {
        mediaType: 'photo',
        quality: 0.7,
        maxWidth: 1280,
        maxHeight: 1280,
        selectionLimit: 1,
      },
      async response => {
        if (response.didCancel) return;
        if (response.errorMessage) {
          Alert.alert('Gallery Error', response.errorMessage);
          return;
        }

        if (response.assets && response.assets.length > 0) {
          const asset = response.assets[0];
          if (!asset.uri) return;

          setIsCapturing(true);
          try {
            const rawUri = ensureFileUri(asset.uri);
            const isLarge = (asset.fileSize || 0) > 850 * 1024;
            let finalUri = rawUri;
            let geoTag: GeoTag | null = null;

            const hasLoc = await requestLocationPermission();
            if (hasLoc) {
              const coords = await getCurrentLocation();
              if (coords) {
                const capturedAt = formatDateTime(new Date());
                const address = await reverseGeocode(coords.latitude, coords.longitude);
                geoTag = { latitude: coords.latitude, longitude: coords.longitude, address, capturedAt };
                finalUri = await stampGeoTag(rawUri, geoTag, isLarge);
              }
            }

            setReplacementUri(finalUri);
            setReplacementGeoTag(geoTag);
          } finally {
            setIsCapturing(false);
          }
        }
      },
    );
  };

  // Submit the replacement photo to server
  const handleSubmitReplacement = async () => {
    if (!replacingPhoto) return;
    if (!replacementUri) {
      Alert.alert('Photo Required', 'Please capture or select a replacement photo first.');
      return;
    }

    const { station, file } = replacingPhoto;
    const submissionId =
      station.InstallationSubmissionId ||
      station.StationSubmissionId ||
      (station as any).installationSubmissionId ||
      0;

    if (!submissionId) {
      Alert.alert(
        'Submission ID Missing',
        'No installation submission ID found on this substation record.',
      );
      return;
    }

    // Prepare UpdatedByUserName (Username - Phone Number)
    const workerName =
      currentVendor.UserName ||
      currentVendor.VendorName ||
      station.WorkerName ||
      'Worker';
    const workerPhone =
      currentVendor.MobileNumber ||
      currentVendor.ContactNumber ||
      station.WorkerMobileNumber ||
      '';
    const vendorName =
      currentVendor.VendorName ||
      currentVendor.ContactPerson ||
      currentVendor.UserName ||
      'Vendor';
    const vendorPhone =
      currentVendor.ContactNumber ||
      currentVendor.MobileNumber ||
      '';

    const rawName = isWorker ? workerName : vendorName;
    const rawPhone = isWorker ? workerPhone : (vendorPhone || workerPhone);
    const updatedByUserName = rawPhone ? `${rawName} - ${rawPhone}` : rawName;

    // Check connectivity
    const netState = await NetInfo.fetch();
    const isOnline = netState.isConnected === true && netState.isInternetReachable !== false;

    if (!isOnline) {
      Alert.alert(
        'Network Required',
        'Re-uploading photos requires an active internet connection to update the server record.',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('InstallationSubmissionId', String(submissionId));
      formData.append('flagId', '2'); // flagId is 2 for both Vendor and Worker
      formData.append(
        'Remarks',
        replacementRemarks.trim() ||
          (replacementGeoTag
            ? `Re-uploaded ${file.fileTypeName} at ${replacementGeoTag.address} (${replacementGeoTag.latitude.toFixed(5)}, ${replacementGeoTag.longitude.toFixed(5)})`
            : `Re-uploaded ${file.fileTypeName}`),
      );
      formData.append('UpdatedByUserName', updatedByUserName);
      formData.append('FileTypeId', JSON.stringify([file.fileTypeId]));

      const fileName = `reupload_${file.fileTypeId}_${Date.now()}.jpg`;
      formData.append('files', {
        uri: Platform.OS === 'android' ? replacementUri : replacementUri.replace('file://', ''),
        name: fileName,
        type: 'image/jpeg',
      } as any);

      const response = await apiService.createReUploadInstallationSubmission(formData);

      // Invalidate image cache for this file
      clearInstallationImageCache(file.installationSubmissionFileId);

      Alert.alert(
        'Re-upload Successful! 🎉',
        response.message || `Photo for "${file.fileTypeName}" has been replaced and updated successfully.`,
        [
          {
            text: 'OK',
            onPress: () => {
              setReplacingPhoto(null);
              setReplacementUri(null);
              setReplacementGeoTag(null);
              setReplacementRemarks('');
              fetchCompletedStations(false);
            },
          },
        ],
      );
    } catch (err: any) {
      console.warn('Replacement submit error:', err);
      Alert.alert(
        'Re-upload Failed',
        err.message || 'Server rejected the re-upload. Please check connectivity and try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered station list
  const filteredStations = useMemo(() => {
    return stations.filter(s => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (s.Station || '').toLowerCase().includes(q) ||
        (s.Taluk || '').toLowerCase().includes(q) ||
        (s.Division || '').toLowerCase().includes(q) ||
        (s.InChangreAEJEname || '').toLowerCase().includes(q) ||
        (s.SwitchSerialNumber || '').toLowerCase().includes(q);

      const matchesVoltage =
        selectedVoltage === 'ALL' || s.VoltageClass === selectedVoltage;

      return matchesSearch && matchesVoltage;
    });
  }, [stations, searchQuery, selectedVoltage]);

  const voltageOptions = useMemo(() => {
    const set = new Set<string>(['66', '110', '220', '400']);
    stations.forEach(s => s.VoltageClass && set.add(s.VoltageClass));
    return ['ALL', ...Array.from(set).sort((a, b) => Number(a) - Number(b))];
  }, [stations]);

  const renderStationCard = ({ item }: { item: CompletedStationItem }) => {
    const isExpanded = expandedStationIds.has(item.VendorStationAssignmentId);
    const files = item.files || [];
    const isHighVoltage = item.VoltageClass === '220' || item.VoltageClass === '400';

    // Group photos by fileTypeId / fileTypeName
    const typeGroupsMap = new Map<
      number,
      {
        fileTypeId: number;
        fileTypeName: string;
        files: CompletedStationFile[];
      }
    >();

    files.forEach(file => {
      const typeId = file.fileTypeId || 0;
      const typeName = file.fileTypeName || `Type #${typeId}`;
      if (!typeGroupsMap.has(typeId)) {
        typeGroupsMap.set(typeId, {
          fileTypeId: typeId,
          fileTypeName: typeName,
          files: [],
        });
      }
      typeGroupsMap.get(typeId)!.files.push(file);
    });

    const typeGroups = Array.from(typeGroupsMap.values()).sort(
      (a, b) => a.fileTypeId - b.fileTypeId,
    );

    return (
      <View style={styles.stationCard}>
        {/* Card Header */}
        <TouchableOpacity
          style={styles.cardHeaderTouch}
          activeOpacity={0.7}
          onPress={() => toggleExpand(item.VendorStationAssignmentId)}>
          <View style={styles.cardHeaderTopRow}>
            <View
              style={[
                styles.voltageBadge,
                isHighVoltage ? styles.voltageBadgeHigh : styles.voltageBadgeStd,
              ]}>
              <Text
                style={[
                  styles.voltageBadgeText,
                  isHighVoltage ? styles.voltageTextHigh : styles.voltageTextStd,
                ]}>
                {item.VoltageClass} kV
              </Text>
            </View>

            <Text style={styles.stationName} numberOfLines={1}>
              {item.Station}
            </Text>

            <View style={styles.filesCountPill}>
              <Text style={styles.filesCountPillText}>📸 {files.length}</Text>
            </View>
          </View>

          {/* Substation Location & Jurisdiction */}
          <Text style={styles.addressLine} numberOfLines={2}>
            📍 {item.Taluk || item.Division} • {item.SubStationAddress}
          </Text>

          {/* AE/JE Engineer */}
          <View style={styles.metaRow}>
            <Text style={styles.engineerText} numberOfLines={1}>
              AE/JE: <Text style={styles.bold}>{item.InChangreAEJEname || 'N/A'}</Text>
              {item.StationContactNumber ? ` (${item.StationContactNumber})` : ''}
            </Text>

            {item.StationContactNumber ? (
              <TouchableOpacity
                style={styles.smallCallBtn}
                onPress={() => handleCall(item.StationContactNumber)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={styles.smallCallBtnText}>📞 Call</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Installed & Last Updated Info */}
          <View style={styles.installedMetaRow}>
            <Text style={styles.installedMetaText}>
              Installed by: <Text style={styles.bold}>{item.InstallationCreatedByUserName || 'Field Engineer'}</Text>
            </Text>
            {item.InstallationUpdatedByUserName ? (
              <Text style={styles.updatedMetaText}>
                Updated by: {item.InstallationUpdatedByUserName}
              </Text>
            ) : null}
          </View>

          {/* Expand / Collapse Indicator */}
          <View style={styles.expandRow}>
            <Text style={styles.expandText}>
              {isExpanded ? '▲ Hide Photos' : `▼ View & Replace Photos (${files.length})`}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Expanded Photo Gallery Grouped by Type */}
        {isExpanded && (
          <View style={styles.expandedGalleryContainer}>
            <View style={styles.galleryDivider} />
            <Text style={styles.galleryHeading}>
              Equipment Photos ({files.length} across {typeGroups.length} {typeGroups.length === 1 ? 'category' : 'categories'}) • Tap photo to view or Replace:
            </Text>

            {files.length === 0 ? (
              <View style={styles.emptyFilesBox}>
                <Text style={styles.emptyFilesText}>No photos found on this station record.</Text>
              </View>
            ) : (
              typeGroups.map(group => (
                <View key={group.fileTypeId} style={styles.typeGroupSection}>
                  {/* Type Group Header */}
                  <View style={styles.typeGroupHeader}>
                    <View style={styles.typeGroupHeaderLeft}>
                      <View style={styles.typeGroupBadge}>
                        <Text style={styles.typeGroupBadgeText}>#{group.fileTypeId}</Text>
                      </View>
                      <Text style={styles.typeGroupTitle} numberOfLines={1}>
                        {group.fileTypeName}
                      </Text>
                    </View>
                    <View style={styles.typeGroupCountPill}>
                      <Text style={styles.typeGroupCountText}>
                        {group.files.length} {group.files.length === 1 ? 'Photo' : 'Photos'}
                      </Text>
                    </View>
                  </View>

                  {/* 2-Column Photo Grid */}
                  <View style={styles.photoGrid}>
                    {group.files.map(file => (
                      <ReUploadPhotoThumbnail
                        key={file.installationSubmissionFileId}
                        file={file}
                        onPress={uri => setViewingPhoto({ uri, file, station: item })}
                        onReplace={() => {
                          setReplacementUri(null);
                          setReplacementGeoTag(null);
                          setReplacementRemarks('');
                          setReplacingPhoto({ file, station: item });
                        }}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.screenContainer}>
      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backBtnIcon}>←</Text>
          <Text style={styles.backBtnText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>🔄 Photo Re-Upload</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {stations.length} Completed Stations • Replace Single Photos
          </Text>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={handleRefresh}
          disabled={isLoading || isRefreshing}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.refreshBtnText}>{isRefreshing ? '...' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* Info Notice Banner */}
      <View style={styles.instructionBanner}>
        <Text style={styles.instructionBannerIcon}>ℹ️</Text>
        <Text style={styles.instructionBannerText}>
          Expand any station to see existing photos fetched from the server. Tap{' '}
          <Text style={styles.bold}>"Replace Photo"</Text> to capture a new photo with embedded GPS watermark.
        </Text>
      </View>

      {/* Search and Voltage Filter */}
      <View style={styles.filterBar}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search station, taluk, AE/JE..."
            placeholderTextColor="#94A3B8"
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

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.voltageScroll}>
          {voltageOptions.map(volt => (
            <TouchableOpacity
              key={volt}
              style={[
                styles.voltageChip,
                selectedVoltage === volt && styles.voltageChipActive,
              ]}
              onPress={() => setSelectedVoltage(volt)}
              activeOpacity={0.75}>
              <Text
                style={[
                  styles.voltageChipText,
                  selectedVoltage === volt && styles.voltageChipTextActive,
                ]}>
                {volt === 'ALL' ? 'All Volts' : `${volt} kV`}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Main List */}
      {isLoading ? (
        <View style={styles.centerLoadingContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.centerLoadingText}>
            Fetching completed stations from server...
          </Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.centerErrorContainer}>
          <Text style={styles.errorEmoji}>⚠️</Text>
          <Text style={styles.errorTitle}>Failed to Load Stations</Text>
          <Text style={styles.errorSub}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchCompletedStations()}>
            <Text style={styles.retryBtnText}>↻ Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredStations}
          keyExtractor={item => String(item.VendorStationAssignmentId)}
          renderItem={renderStationCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#2563EB"
              colors={['#2563EB']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={styles.emptyTitle}>No Stations Found</Text>
              <Text style={styles.emptySub}>
                {searchQuery
                  ? 'No completed stations match your search or voltage filter.'
                  : 'No completed station submissions found on record.'}
              </Text>
            </View>
          }
        />
      )}

      {/* MODAL 1: Full-Screen Photo Viewer */}
      <Modal
        visible={!!viewingPhoto}
        transparent={true}
        animationType="fade"
        statusBarTranslucent={true}
        onRequestClose={() => setViewingPhoto(null)}>
        <SafeAreaView style={styles.fullViewerOverlay} edges={['top', 'bottom']}>
          <StatusBar barStyle="light-content" />
          <View style={styles.fullViewerHeader}>
            <View style={styles.fullViewerTitleWrap}>
              <Text style={styles.fullViewerCategory} numberOfLines={1}>
                {viewingPhoto?.file.fileTypeName}
              </Text>
              <Text style={styles.fullViewerSubtitle} numberOfLines={1}>
                {viewingPhoto?.station.Station} • #{viewingPhoto?.file.installationSubmissionFileId}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.fullViewerCloseBtn}
              onPress={() => setViewingPhoto(null)}>
              <Text style={styles.fullViewerCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.fullViewerImgWrap}>
            {viewingPhoto && (
              <Image
                source={{ uri: viewingPhoto.uri }}
                style={styles.fullViewerImage}
                resizeMode="contain"
              />
            )}
          </View>

          <View style={styles.fullViewerFooter}>
            <TouchableOpacity
              style={styles.fullViewerReplaceBtn}
              activeOpacity={0.85}
              onPress={() => {
                if (viewingPhoto) {
                  const target = viewingPhoto;
                  setViewingPhoto(null);
                  setReplacementUri(null);
                  setReplacementGeoTag(null);
                  setReplacementRemarks('');
                  setReplacingPhoto({ file: target.file, station: target.station });
                }
              }}>
              <Text style={styles.fullViewerReplaceBtnText}>
                🔄 Replace This Photo
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* MODAL 2: Replace Single Photo Modal */}
      <Modal
        visible={!!replacingPhoto}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          if (!isSubmitting) setReplacingPhoto(null);
        }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                <Text style={styles.modalTitle}>🔄 Replace Single Photo</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {replacingPhoto?.station.Station} • {replacingPhoto?.file.fileTypeName}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => {
                  if (!isSubmitting) setReplacingPhoto(null);
                }}
                disabled={isSubmitting}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Equipment Info Strip */}
              <View style={styles.targetInfoCard}>
                <Text style={styles.targetInfoLabel}>Replacing Category:</Text>
                <Text style={styles.targetInfoValue}>
                  #{replacingPhoto?.file.fileTypeId} {replacingPhoto?.file.fileTypeName}
                </Text>
                <Text style={styles.targetFileSub}>
                  Current file: {replacingPhoto?.file.fileName}
                </Text>
              </View>

              {/* Photo Capture Preview Section */}
              <View style={styles.captureSection}>
                <Text style={styles.sectionHeading}>Replacement Photo Proof</Text>

                {replacementUri ? (
                  <View style={styles.previewCard}>
                    <Image
                      source={{ uri: replacementUri }}
                      style={styles.previewImg}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      style={styles.retakeFloatingBtn}
                      onPress={handleLaunchCamera}
                      activeOpacity={0.8}>
                      <Text style={styles.retakeFloatingBtnText}>📷 Retake Live</Text>
                    </TouchableOpacity>

                    {replacementGeoTag && (
                      <View style={styles.geoTagBanner}>
                        <Text style={styles.geoTagAddr} numberOfLines={2}>
                          📍 {replacementGeoTag.address}
                        </Text>
                        <Text style={styles.geoTagCoords}>
                          GPS: {replacementGeoTag.latitude.toFixed(5)},{' '}
                          {replacementGeoTag.longitude.toFixed(5)} • {replacementGeoTag.capturedAt}
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={styles.placeholderContainer}>
                    {isCapturing ? (
                      <View style={styles.capturingCenter}>
                        <ActivityIndicator size="small" color="#2563EB" />
                        <Text style={styles.capturingText}>Stamping GPS &amp; address...</Text>
                      </View>
                    ) : (
                      <>
                        <Text style={styles.placeholderIcon}>📸</Text>
                        <Text style={styles.placeholderTitle}>
                          Capture or Select Replacement Photo
                        </Text>
                        <Text style={styles.placeholderSub}>
                          GPS coordinates, location address and timestamp will be embedded automatically.
                        </Text>

                        <View style={styles.actionButtonsRow}>
                          <TouchableOpacity
                            style={styles.cameraActionBtn}
                            onPress={handleLaunchCamera}
                            activeOpacity={0.8}>
                            <Text style={styles.actionBtnIcon}>📷</Text>
                            <Text style={styles.cameraActionBtnText}>Live Camera</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.galleryActionBtn}
                            onPress={handleLaunchGallery}
                            activeOpacity={0.8}>
                            <Text style={styles.actionBtnIcon}>🖼️</Text>
                            <Text style={styles.galleryActionBtnText}>Pick Gallery</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    )}
                  </View>
                )}
              </View>

              {/* Remarks Input */}
              <View style={styles.remarksSection}>
                <Text style={styles.sectionHeading}>Remarks (Optional)</Text>
                <TextInput
                  style={styles.remarksInput}
                  placeholder="Reason for replacing this photo..."
                  placeholderTextColor="#94A3B8"
                  value={replacementRemarks}
                  onChangeText={setReplacementRemarks}
                  multiline
                  numberOfLines={2}
                />
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  if (!isSubmitting) setReplacingPhoto(null);
                }}
                disabled={isSubmitting}
                activeOpacity={0.7}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  (!replacementUri || isSubmitting) && styles.submitBtnDisabled,
                ]}
                onPress={handleSubmitReplacement}
                disabled={!replacementUri || isSubmitting}
                activeOpacity={0.85}>
                {isSubmitting ? (
                  <View style={styles.submitLoadingRow}>
                    <ActivityIndicator size="small" color="#1F2937" />
                    <Text style={styles.submitBtnText}>Uploading...</Text>
                  </View>
                ) : (
                  <Text style={styles.submitBtnText}>📤 Confirm &amp; Re-upload</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  header: {
    backgroundColor: '#0F172A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1E293B',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  backBtnIcon: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: '700',
  },
  backBtnText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  headerTitleWrap: {
    flex: 1,
    marginHorizontal: 10,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: '#1E293B',
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: '700',
  },
  instructionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderBottomWidth: 1,
    borderBottomColor: '#BFDBFE',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  instructionBannerIcon: {
    fontSize: 16,
  },
  instructionBannerText: {
    fontSize: 11,
    color: '#1E40AF',
    flex: 1,
    lineHeight: 16,
  },
  filterBar: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    marginBottom: 8,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },
  searchClear: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  voltageScroll: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  voltageChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  voltageChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  voltageChipText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  voltageChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listContent: {
    padding: 14,
    paddingBottom: 40,
  },
  stationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeaderTouch: {
    padding: 14,
  },
  cardHeaderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  voltageBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  voltageBadgeStd: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  voltageBadgeHigh: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  voltageBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  voltageTextStd: {
    color: '#1D4ED8',
  },
  voltageTextHigh: {
    color: '#DC2626',
  },
  stationName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  filesCountPill: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  filesCountPillText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
  },
  addressLine: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  engineerText: {
    fontSize: 11,
    color: '#334155',
    flex: 1,
  },
  smallCallBtn: {
    backgroundColor: '#10B981',
    borderRadius: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginLeft: 6,
  },
  smallCallBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  installedMetaRow: {
    flexDirection: 'column',
    gap: 2,
    marginBottom: 6,
  },
  installedMetaText: {
    fontSize: 11,
    color: '#64748B',
  },
  updatedMetaText: {
    fontSize: 10,
    color: '#B45309',
    fontWeight: '600',
  },
  expandRow: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'center',
  },
  expandText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  expandedGalleryContainer: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  galleryDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginBottom: 10,
  },
  galleryHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 10,
  },
  emptyFilesBox: {
    padding: 16,
    alignItems: 'center',
  },
  emptyFilesText: {
    fontSize: 12,
    color: '#94A3B8',
  },
  typeGroupSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginBottom: 12,
  },
  typeGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  typeGroupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  typeGroupBadge: {
    backgroundColor: '#0F172A',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  typeGroupBadgeText: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
  },
  typeGroupTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  typeGroupCountPill: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeGroupCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 10,
  },
  photoItemCard: {
    width: '48.2%',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  photoThumbTouch: {
    width: '100%',
  },
  photoThumbWrap: {
    width: '100%',
    height: 105,
    backgroundColor: '#0F172A',
    position: 'relative',
  },
  photoImg: {
    width: '100%',
    height: '100%',
  },
  photoLoadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoLoadingText: {
    color: '#94A3B8',
    fontSize: 10,
  },
  photoErrorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  photoErrorIcon: {
    fontSize: 16,
  },
  photoErrorText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '600',
  },
  fileTypeBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  fileTypeBadgeText: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '700',
  },
  photoItemMeta: {
    padding: 8,
  },
  photoFileName: {
    fontSize: 9,
    color: '#64748B',
    marginBottom: 6,
  },
  replaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF9C3',
    borderWidth: 1.2,
    borderColor: '#EAB308',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    gap: 4,
  },
  replaceBtnIcon: {
    fontSize: 11,
  },
  replaceBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#854D0E',
  },
  centerLoadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    gap: 12,
  },
  centerLoadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  centerErrorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    gap: 10,
  },
  errorEmoji: {
    fontSize: 36,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  errorSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 280,
  },
  retryBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 8,
    marginTop: 6,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 50,
    gap: 6,
  },
  emptyEmoji: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 280,
  },
  fullViewerOverlay: {
    flex: 1,
    backgroundColor: '#090D16',
  },
  fullViewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#090D16',
  },
  fullViewerTitleWrap: {
    flex: 1,
    marginRight: 12,
  },
  fullViewerCategory: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  fullViewerSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  fullViewerCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullViewerCloseText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  fullViewerImgWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullViewerImage: {
    width: '100%',
    height: '100%',
  },
  fullViewerFooter: {
    padding: 16,
    backgroundColor: '#090D16',
  },
  fullViewerReplaceBtn: {
    backgroundColor: '#FACC15',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullViewerReplaceBtnText: {
    color: '#1F2937',
    fontSize: 14,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '92%',
    paddingBottom: Platform.OS === 'android' ? 16 : 30,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitleWrap: {
    flex: 1,
    marginRight: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
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
    fontSize: 16,
    color: '#475569',
    fontWeight: '700',
  },
  modalBody: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  targetInfoCard: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 16,
  },
  targetInfoLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  targetInfoValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1D4ED8',
    marginTop: 2,
  },
  targetFileSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  captureSection: {
    marginBottom: 16,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  previewCard: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    position: 'relative',
  },
  previewImg: {
    width: '100%',
    height: 210,
    backgroundColor: '#0F172A',
  },
  retakeFloatingBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  retakeFloatingBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  geoTagBanner: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  geoTagAddr: {
    fontSize: 11,
    color: '#0F172A',
    fontWeight: '600',
  },
  geoTagCoords: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 2,
  },
  placeholderContainer: {
    backgroundColor: '#F8FAFC',
    borderWidth: 2,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 34,
    marginBottom: 6,
  },
  placeholderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  placeholderSub: {
    fontSize: 11,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 15,
    marginBottom: 16,
  },
  capturingCenter: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  capturingText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cameraActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 11,
    gap: 6,
  },
  galleryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 11,
    gap: 6,
  },
  actionBtnIcon: {
    fontSize: 14,
  },
  cameraActionBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  galleryActionBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  remarksSection: {
    marginBottom: 16,
  },
  remarksInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 50,
    textAlignVertical: 'top',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  submitBtn: {
    flex: 1,
    backgroundColor: '#FACC15',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: '#CBD5E1',
  },
  submitLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1F2937',
  },
  bold: {
    fontWeight: '700',
  },
});
