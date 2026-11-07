import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  PermissionsAndroid,
  Modal,
  ScrollView,
  StatusBar,
} from 'react-native';
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';
import Geolocation from 'react-native-geolocation-service';
import Marker, { Position, ImageFormat } from 'react-native-image-marker';
import { apiService } from '../api/apiService';
import NetInfo from '@react-native-community/netinfo';
import {
  StationItem,
  CompletedStationItem,
  VendorFileType,
  VendorProfile,
  DEFAULT_FILE_TYPES,
} from '../types';
import { getCachedFileTypes, ensureFileUri } from '../db/sqliteService';

interface ReUploadPhotoModalProps {
  visible: boolean;
  station: StationItem | CompletedStationItem;
  currentVendor: VendorProfile;
  isWorker?: boolean;
  initialFileTypeId?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface GeoTag {
  latitude: number;
  longitude: number;
  address: string;
  capturedAt: string;
}

export interface ReUploadPhotoItem {
  id: string;
  uri: string;
  fileTypeId: number;
  fileTypeName: string;
  geoTag?: GeoTag | null;
  capturedAt: string;
  fileSize?: number;
}

// Reverse-geocode using OpenStreetMap Nominatim with safe timeout
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

export const ReUploadPhotoModal: React.FC<ReUploadPhotoModalProps> = ({
  visible,
  station,
  currentVendor,
  isWorker: propIsWorker,
  initialFileTypeId,
  onClose,
  onSuccess,
}) => {
  const isWorker =
    propIsWorker !== undefined
      ? propIsWorker
      : (currentVendor.RoleId === 9 ||
         currentVendor.userType === 'VendorWorker' ||
         Boolean(currentVendor.VendorWorkerId) ||
         Boolean((currentVendor as any)?.WorkerId));

  const [categories, setCategories] = useState<VendorFileType[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState<boolean>(true);
  const [selectedFileTypeId, setSelectedFileTypeId] = useState<number | null>(null);

  // Array of photos to upload in this re-upload session
  const [capturedPhotos, setCapturedPhotos] = useState<ReUploadPhotoItem[]>([]);
  const [remarks, setRemarks] = useState<string>('');
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Load categories from the API
  useEffect(() => {
    if (!visible) return;

    let isMounted = true;
    const fetchCategories = async () => {
      setIsLoadingCategories(true);
      try {
        let types: VendorFileType[] = [];
        try {
          types = isWorker
            ? await apiService.fetchWorkerInsertDropdown(1)
            : await apiService.fetchAssignStationDetailDropdown(2);
        } catch (netErr) {
          console.warn('[ReUpload] Dropdown fetch error, using cache:', netErr);
        }

        if (!types || types.length === 0) {
          types = await getCachedFileTypes();
        }
        if (!types || types.length === 0) {
          types = DEFAULT_FILE_TYPES;
        }

        if (isMounted) {
          setCategories(types);
          if (initialFileTypeId) {
            setSelectedFileTypeId(initialFileTypeId);
          } else if (types.length > 0 && !selectedFileTypeId) {
            setSelectedFileTypeId(types[0].VendorFileTypeId);
          }
        }
      } catch (err) {
        console.warn('[ReUpload] Failed to load categories:', err);
        if (isMounted) {
          setCategories(DEFAULT_FILE_TYPES);
          if (initialFileTypeId) setSelectedFileTypeId(initialFileTypeId);
        }
      } finally {
        if (isMounted) setIsLoadingCategories(false);
      }
    };

    fetchCategories();
    return () => {
      isMounted = false;
    };
  }, [visible, isWorker, initialFileTypeId]);

  // Reset state when opening/closing
  useEffect(() => {
    if (visible) {
      setCapturedPhotos([]);
      setRemarks('');
      if (initialFileTypeId) {
        setSelectedFileTypeId(initialFileTypeId);
      }
    }
  }, [visible, initialFileTypeId]);

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Access Needed',
          message: 'Camera permission is required to capture re-upload proof photos.',
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
          message: 'Location access is required to embed GPS coordinates on re-uploaded photos.',
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

  // Launch Camera to capture photo
  const handleLaunchCamera = async () => {
    if (!selectedFileTypeId) {
      Alert.alert('Category Required', 'Please select a photo category first.');
      return;
    }

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
            const selectedCategory = categories.find(c => c.VendorFileTypeId === selectedFileTypeId);
            const catName = selectedCategory?.VendorFileTypeName || `Type #${selectedFileTypeId}`;
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

            const newPhoto: ReUploadPhotoItem = {
              id: `${selectedFileTypeId}_${Date.now()}_${Math.random()}`,
              uri: finalUri,
              fileTypeId: selectedFileTypeId,
              fileTypeName: catName,
              geoTag,
              capturedAt: formatDateTime(new Date()),
              fileSize: asset.fileSize,
            };

            setCapturedPhotos(prev => [...prev, newPhoto]);
          } finally {
            setIsCapturing(false);
          }
        }
      },
    );
  };

  // Launch Gallery to pick one or multiple photos
  const handleLaunchGallery = async () => {
    if (!selectedFileTypeId) {
      Alert.alert('Category Required', 'Please select a photo category first.');
      return;
    }

    launchImageLibrary(
      {
        mediaType: 'photo',
        quality: 0.7,
        maxWidth: 1280,
        maxHeight: 1280,
        selectionLimit: 0, // 0 = allow selecting multiple photos
      },
      async response => {
        if (response.didCancel) return;
        if (response.errorMessage) {
          Alert.alert('Gallery Error', response.errorMessage);
          return;
        }

        if (response.assets && response.assets.length > 0) {
          setIsCapturing(true);
          try {
            const selectedCategory = categories.find(c => c.VendorFileTypeId === selectedFileTypeId);
            const catName = selectedCategory?.VendorFileTypeName || `Type #${selectedFileTypeId}`;

            let geoTag: GeoTag | null = null;
            const hasLoc = await requestLocationPermission();
            if (hasLoc) {
              const coords = await getCurrentLocation();
              if (coords) {
                const capturedAt = formatDateTime(new Date());
                const address = await reverseGeocode(coords.latitude, coords.longitude);
                geoTag = { latitude: coords.latitude, longitude: coords.longitude, address, capturedAt };
              }
            }

            const newPhotos: ReUploadPhotoItem[] = [];
            for (let i = 0; i < response.assets.length; i++) {
              const asset = response.assets[i];
              if (!asset.uri) continue;
              const rawUri = ensureFileUri(asset.uri);
              const isLarge = (asset.fileSize || 0) > 850 * 1024;
              let finalUri = rawUri;
              if (geoTag) {
                finalUri = await stampGeoTag(rawUri, geoTag, isLarge);
              }
              newPhotos.push({
                id: `${selectedFileTypeId}_${Date.now()}_${i}`,
                uri: finalUri,
                fileTypeId: selectedFileTypeId,
                fileTypeName: catName,
                geoTag,
                capturedAt: formatDateTime(new Date()),
                fileSize: asset.fileSize,
              });
            }

            setCapturedPhotos(prev => [...prev, ...newPhotos]);
          } finally {
            setIsCapturing(false);
          }
        }
      },
    );
  };

  const handleRemovePhoto = (index: number) => {
    setCapturedPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmitReUpload = async () => {
    if (capturedPhotos.length === 0) {
      Alert.alert('Photos Required', 'Please capture or attach at least one photo before submitting re-upload.');
      return;
    }

    // Get InstallationSubmissionId from station
    const installationSubmissionId =
      station.InstallationSubmissionId ||
      (station as any).StationSubmissionId ||
      (station as any).installationSubmissionId ||
      (station as any).stationSubmissionId ||
      0;

    if (!installationSubmissionId) {
      Alert.alert(
        'Submission ID Missing',
        'Unable to re-upload because no previous installation submission ID was found for this substation record.',
      );
      return;
    }

    // Prepare UpdatedByUserName (Username + Phone Number concat)
    const workerName =
      currentVendor.UserName ||
      currentVendor.VendorName ||
      (station as any).WorkerName ||
      'Worker';
    const workerPhone =
      currentVendor.MobileNumber ||
      currentVendor.ContactNumber ||
      (station as any).WorkerMobileNumber ||
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
      const submissionFileTypeIds: number[] = capturedPhotos.map(p => p.fileTypeId);
      const catNames = Array.from(new Set(capturedPhotos.map(p => p.fileTypeName))).join(', ');

      const formData = new FormData();
      formData.append('InstallationSubmissionId', String(installationSubmissionId));
      formData.append('flagId', '2'); // flagId is 2 for both Vendor and Worker as instructed
      formData.append(
        'Remarks',
        remarks.trim() || `Re-uploaded ${capturedPhotos.length} photo(s) for ${catNames}`,
      );
      formData.append('UpdatedByUserName', updatedByUserName);
      formData.append('FileTypeId', JSON.stringify(submissionFileTypeIds));

      capturedPhotos.forEach((photo, idx) => {
        const fileName = `reupload_${photo.fileTypeId}_${idx + 1}_${Date.now()}.jpg`;
        formData.append('files', {
          uri: Platform.OS === 'android' ? photo.uri : photo.uri.replace('file://', ''),
          name: fileName,
          type: 'image/jpeg',
        } as any);
      });

      const response = await apiService.createReUploadInstallationSubmission(formData);

      Alert.alert(
        'Re-upload Successful! 🎉',
        response.message || `${capturedPhotos.length} photo(s) have been re-uploaded successfully to the server.`,
        [
          {
            text: 'OK',
            onPress: () => {
              onSuccess();
              onClose();
            },
          },
        ],
      );
    } catch (err: any) {
      console.warn('Re-upload failed:', err);
      Alert.alert(
        'Re-upload Failed',
        err.message || 'Server rejected the re-upload submission. Please verify connectivity and try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedCategory = categories.find(c => c.VendorFileTypeId === selectedFileTypeId);

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleWrap}>
              <Text style={styles.modalTitle}>🔄 Re-upload Photo Proof</Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {station.Station} • Voltage: {station.VoltageClass || 'N/A'} kV
              </Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
            {/* Notice */}
            <View style={styles.noticeBox}>
              <Text style={styles.noticeText}>
                Select an equipment category, then capture live photos or select multiple from gallery. You can attach multiple photos across one or more categories before submitting.
              </Text>
            </View>

            {/* 1. Category Selector */}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>1. Select Equipment Category</Text>
              {isLoadingCategories ? (
                <View style={styles.loadingBox}>
                  <ActivityIndicator size="small" color="#2563EB" />
                  <Text style={styles.loadingText}>Loading categories from API...</Text>
                </View>
              ) : (
                <View style={styles.categoryGrid}>
                  {categories.map(cat => {
                    const isSelected = cat.VendorFileTypeId === selectedFileTypeId;
                    const catCount = capturedPhotos.filter(p => p.fileTypeId === cat.VendorFileTypeId).length;
                    return (
                      <TouchableOpacity
                        key={cat.VendorFileTypeId}
                        style={[
                          styles.categoryPill,
                          isSelected && styles.categoryPillSelected,
                        ]}
                        onPress={() => setSelectedFileTypeId(cat.VendorFileTypeId)}
                        activeOpacity={0.75}>
                        <Text
                          style={[
                            styles.categoryPillNumber,
                            isSelected && styles.categoryPillNumberSelected,
                          ]}>
                          #{cat.VendorFileTypeId}
                        </Text>
                        <Text
                          style={[
                            styles.categoryPillText,
                            isSelected && styles.categoryPillTextSelected,
                          ]}
                          numberOfLines={1}>
                          {cat.VendorFileTypeName}
                        </Text>
                        {catCount > 0 && (
                          <View style={styles.categoryCountBadge}>
                            <Text style={styles.categoryCountBadgeText}>{catCount}</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            {/* 2. Photo Capture / Gallery Actions */}
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionLabel}>
                  2. Capture / Add Photos ({selectedCategory?.VendorFileTypeName || 'Select Category'})
                </Text>
                {capturedPhotos.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setCapturedPhotos([])}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={styles.clearAllText}>Clear All ({capturedPhotos.length})</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Action Buttons: Camera & Gallery */}
              <View style={styles.captureActionRow}>
                <TouchableOpacity
                  style={[styles.captureBtn, isCapturing && styles.actionBtnDisabled]}
                  onPress={handleLaunchCamera}
                  disabled={isCapturing}
                  activeOpacity={0.8}>
                  {isCapturing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Text style={styles.captureBtnIcon}>📷</Text>
                      <Text style={styles.captureBtnText}>Live Camera</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.galleryPickBtn, isCapturing && styles.actionBtnDisabled]}
                  onPress={handleLaunchGallery}
                  disabled={isCapturing}
                  activeOpacity={0.8}>
                  <Text style={styles.galleryPickBtnIcon}>🖼️</Text>
                  <Text style={styles.galleryPickBtnText}>Select from Gallery</Text>
                </TouchableOpacity>
              </View>

              {/* Photos List Preview */}
              {capturedPhotos.length > 0 ? (
                <View style={styles.photosListContainer}>
                  <Text style={styles.photosListTitle}>
                    Attached Photos for Upload ({capturedPhotos.length})
                  </Text>
                  <View style={styles.photoGrid}>
                    {capturedPhotos.map((photo, idx) => (
                      <View key={photo.id || idx} style={styles.photoGridCard}>
                        <Image source={{ uri: photo.uri }} style={styles.photoGridImg} resizeMode="cover" />
                        <View style={styles.photoCardMeta}>
                          <View style={styles.photoCategoryBadge}>
                            <Text style={styles.photoCategoryBadgeText} numberOfLines={1}>
                              #{photo.fileTypeId} {photo.fileTypeName}
                            </Text>
                          </View>
                          {photo.geoTag ? (
                            <Text style={styles.photoCoordText} numberOfLines={1}>
                              📍 {photo.geoTag.latitude.toFixed(4)}, {photo.geoTag.longitude.toFixed(4)}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={styles.photoDeleteBtn}
                          onPress={() => handleRemovePhoto(idx)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                          <Text style={styles.photoDeleteBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.emptyPhotosNotice}>
                  <Text style={styles.emptyPhotosEmoji}>📸</Text>
                  <Text style={styles.emptyPhotosTitle}>No Photos Added Yet</Text>
                  <Text style={styles.emptyPhotosSub}>
                    Tap Live Camera or Select from Gallery above to attach photos for re-upload.
                  </Text>
                </View>
              )}
            </View>

            {/* 3. Remarks Input */}
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>3. Remarks (Optional)</Text>
              <TextInput
                style={styles.remarksInput}
                placeholder="Enter re-upload reason or remarks (optional)..."
                placeholderTextColor="#94A3B8"
                value={remarks}
                onChangeText={setRemarks}
                multiline
                numberOfLines={2}
              />
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Footer Submit Bar */}
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={onClose}
              disabled={isSubmitting}
              activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.submitBtn,
                (capturedPhotos.length === 0 || isSubmitting) && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmitReUpload}
              disabled={capturedPhotos.length === 0 || isSubmitting}
              activeOpacity={0.85}>
              {isSubmitting ? (
                <View style={styles.submitLoadingRow}>
                  <ActivityIndicator size="small" color="#1F2937" />
                  <Text style={styles.submitBtnText}>Submitting Re-upload...</Text>
                </View>
              ) : (
                <Text style={styles.submitBtnText}>
                  📤 Submit Re-upload ({capturedPhotos.length})
                </Text>
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
    fontSize: 18,
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
  noticeBox: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noticeText: {
    fontSize: 12,
    color: '#1E40AF',
    lineHeight: 17,
  },
  sectionBlock: {
    marginBottom: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  clearAllText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 12,
    color: '#64748B',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 6,
  },
  categoryPillSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: '#2563EB',
  },
  categoryPillNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748B',
  },
  categoryPillNumberSelected: {
    color: '#1D4ED8',
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
    maxWidth: 200,
  },
  categoryPillTextSelected: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  categoryCountBadge: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 2,
  },
  categoryCountBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  captureActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  captureBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6,
  },
  captureBtnIcon: {
    fontSize: 16,
  },
  captureBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  galleryPickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6,
  },
  galleryPickBtnIcon: {
    fontSize: 16,
  },
  galleryPickBtnText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  emptyPhotosNotice: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPhotosEmoji: {
    fontSize: 28,
    marginBottom: 4,
  },
  emptyPhotosTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 2,
  },
  emptyPhotosSub: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },
  photosListContainer: {
    marginTop: 4,
  },
  photosListTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoGridCard: {
    width: '48%',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
  },
  photoGridImg: {
    width: '100%',
    height: 110,
    backgroundColor: '#0F172A',
  },
  photoCardMeta: {
    padding: 6,
  },
  photoCategoryBadge: {
    backgroundColor: '#EFF6FF',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginBottom: 3,
  },
  photoCategoryBadgeText: {
    color: '#1D4ED8',
    fontSize: 10,
    fontWeight: '700',
  },
  photoCoordText: {
    color: '#64748B',
    fontSize: 9,
  },
  photoDeleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(220, 38, 38, 0.9)',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoDeleteBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  remarksInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 12,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 60,
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
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  submitBtn: {
    flex: 1,
    backgroundColor: '#FACC15',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#CA8A04',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 4,
  },
  submitBtnDisabled: {
    backgroundColor: '#CBD5E1',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1F2937',
  },
});
