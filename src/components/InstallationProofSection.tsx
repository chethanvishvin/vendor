import React, { useState, useEffect, useRef } from 'react';
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
  StatusBar,
} from 'react-native';
import {
  launchCamera,
  Asset,
} from 'react-native-image-picker';
import Geolocation from 'react-native-geolocation-service';
import Marker, { Position, ImageFormat } from 'react-native-image-marker';
import { apiService } from '../api/apiService';
import NetInfo from '@react-native-community/netinfo';
import { StationItem, VendorFileType, VendorProfile } from '../types';
import {
  saveDraftPhoto,
  saveDraftHardwareDetails,
  removeDraftPhoto,
  saveDraftRemarks,
  getStationProofDraft,
  clearStationProofDraft,
  saveCachedFileTypes,
  getCachedFileTypes,
  queueOfflineSubmission,
  OfflineSubmissionFile,
  ensureFileUri,
} from '../db/sqliteService';

interface InstallationProofSectionProps {
  station: StationItem;
  currentVendor: VendorProfile;
  onSuccess: () => void;
}

interface GeoTag {
  latitude: number;
  longitude: number;
  address: string;
  capturedAt: string;
}

interface TaggedAsset extends Asset {
  geoTag?: GeoTag;
  taggedUri?: string;
}

interface SelectedFileMap {
  [fileTypeId: number]: TaggedAsset;
}

interface ViewingPhotoInfo {
  uri: string;
  typeName: string;
  fileTypeId: number;
  fileName?: string;
  fileSize?: number;
  geoTag?: GeoTag;
  distanceMeters?: number | null;
  isWithin300m?: boolean;
}

export interface SerialMatchResult {
  status: 'empty' | 'match' | 'mismatch' | 'no_assigned';
  message: string;
}

/**
 * Normalizes hardware serial numbers by stripping common prefixes (SN:, SL NO:, etc.),
 * spaces, hyphens and converting to uppercase for robust matching.
 */
export const normalizeSerial = (val?: string | null): string => {
  if (!val) return '';
  return val
    .toUpperCase()
    .replace(/^(SN|S\/N|SL\s*NO|SLNO)\s*[:.\-]?\s*/i, '')
    .replace(/[\s\-_]/g, '')
    .trim();
};

/**
 * Compares user entered serial number against the assigned station record
 */
export const checkSerialMatch = (
  userInput: string,
  assignedSerial?: string | null,
): SerialMatchResult => {
  const assigned = (assignedSerial || '').trim();
  const input = userInput.trim();

  if (
    !assigned ||
    assigned === '-' ||
    assigned.toUpperCase() === 'N/A' ||
    assigned.toUpperCase() === 'NOT RECORDED'
  ) {
    return {
      status: 'no_assigned',
      message: 'No assigned serial number on system record',
    };
  }

  if (!input) {
    return {
      status: 'empty',
      message: `Assigned: ${assigned}`,
    };
  }

  const normInput = normalizeSerial(input);
  const normAssigned = normalizeSerial(assigned);

  if (
    normInput === normAssigned ||
    input.toUpperCase() === assigned.toUpperCase()
  ) {
    return {
      status: 'match',
      message: `✓ Verified: Matches assigned (${assigned})`,
    };
  }

  return {
    status: 'mismatch',
    message: `⚠️ Mismatch: System has "${assigned}"`,
  };
};

// Calculate distance in meters between two lat/long points using Haversine formula
export const calculateDistanceMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
};

export interface ProximityResult {
  hasSubstationCoords: boolean;
  substationLat: number | null;
  substationLon: number | null;
  distanceMeters: number | null;
  isWithin300m: boolean;
  statusText: string;
}

export const checkSubstationProximity = (
  stationLatStr?: string | null,
  stationLonStr?: string | null,
  photoLat?: number | null,
  photoLon?: number | null,
): ProximityResult => {
  if (
    stationLatStr == null ||
    stationLonStr == null ||
    photoLat == null ||
    photoLon == null
  ) {
    return {
      hasSubstationCoords: false,
      substationLat: null,
      substationLon: null,
      distanceMeters: null,
      isWithin300m: false,
      statusText: 'Coordinates unavailable',
    };
  }

  const subLat = parseFloat(String(stationLatStr).trim());
  const subLon = parseFloat(String(stationLonStr).trim());

  if (isNaN(subLat) || isNaN(subLon) || (subLat === 0 && subLon === 0)) {
    return {
      hasSubstationCoords: false,
      substationLat: null,
      substationLon: null,
      distanceMeters: null,
      isWithin300m: false,
      statusText: 'Substation GPS not configured',
    };
  }

  const distance = calculateDistanceMeters(subLat, subLon, photoLat, photoLon);
  const isWithin = distance <= 300;

  return {
    hasSubstationCoords: true,
    substationLat: subLat,
    substationLon: subLon,
    distanceMeters: distance,
    isWithin300m: isWithin,
    statusText: isWithin
      ? `Within 300m radius (${distance}m from substation)`
      : `Outside 300m radius (${distance}m from substation)`,
  };
};

/**
 * Automatically builds the audit remarks string in the background based on all attached photo geo-tags
 */
export const buildAutomaticRemarks = (
  station: StationItem,
  selectedFiles: SelectedFileMap,
): string => {
  const fileKeys = Object.keys(selectedFiles).map(Number);
  const subLat = parseFloat(String(station.Latitude || '').trim());
  const subLon = parseFloat(String(station.Longitude || '').trim());
  const hasSubCoords = !isNaN(subLat) && !isNaN(subLon) && (subLat !== 0 || subLon !== 0);

  const photoPoints: {
    fileTypeId: number;
    lat: number;
    lon: number;
    distance: number | null;
    isWithin: boolean;
    address: string;
  }[] = [];

  for (const key of fileKeys) {
    const asset = selectedFiles[key];
    if (asset?.geoTag) {
      const distance = hasSubCoords
        ? calculateDistanceMeters(subLat, subLon, asset.geoTag.latitude, asset.geoTag.longitude)
        : null;
      photoPoints.push({
        fileTypeId: key,
        lat: asset.geoTag.latitude,
        lon: asset.geoTag.longitude,
        distance,
        isWithin: distance !== null ? distance <= 300 : false,
        address: asset.geoTag.address,
      });
    }
  }

  if (photoPoints.length === 0) {
    return `Installation completed for ${station.Station}.`;
  }

  if (!hasSubCoords) {
    const p = photoPoints[0];
    return `Photo GPS: (${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}). Substation GPS not configured in system. Location: ${p.address}`;
  }

  const validDistances = photoPoints
    .map(p => p.distance)
    .filter((d): d is number => d !== null);

  const minDistance = Math.min(...validDistances);
  const maxDistance = Math.max(...validDistances);
  const avgDistance = Math.round(
    validDistances.reduce((sum, d) => sum + d, 0) / validDistances.length,
  );
  const allWithin = photoPoints.every(p => p.isWithin);

  const radiusStatus = allWithin
    ? `Verified within 300m radius (Distance: ${avgDistance}m)`
    : `Captured outside 300m radius (Distance: ${avgDistance}m)`;

  const p0 = photoPoints[0];
  return `${radiusStatus}. Photo GPS: (${p0.lat.toFixed(5)}, ${p0.lon.toFixed(5)}). Substation GPS: (${subLat.toFixed(5)}, ${subLon.toFixed(5)}). Location: ${p0.address}`;
};

// Reverse-geocode using OpenStreetMap Nominatim (free, no API key needed)
const reverseGeocode = async (lat: number, lon: number): Promise<string> => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'VendorProofApp/1.0',
        },
      },
    );
    if (!response.ok) throw new Error('Geocode request failed');
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

const stampGeoTag = async (imageUri: string, geoTag: GeoTag): Promise<string> => {
  try {
    const coordStr = `${geoTag.latitude.toFixed(5)}, ${geoTag.longitude.toFixed(5)}`;
    const addrStr = geoTag.address.length > 80 ? geoTag.address.substring(0, 80) + '...' : geoTag.address;

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
          position: { position: Position.bottomLeft, X: 24, Y: 24 },
          style: {
            color: '#FFFFFF',
            fontSize: 40,
            fontSizeRatio: 0.035, // 3.5% of photo width - scales sharply on high-res camera photos
            bold: true,
            maxWidth: '92%',
            shadowStyle: { dx: 2, dy: 2, radius: 4, color: '#000000' },
            textBackgroundStyle: {
              paddingX: 20,
              paddingY: 16,
              color: '#000000E6', // High-contrast solid dark backing
              cornerRadius: { all: { x: 10, y: 10 } },
            },
          },
        },
      ],
      filename: `geotagged_${Date.now()}`,
      saveFormat: ImageFormat.jpg,
      quality: 92,
    });

    const finalUri = result?.uri ? ensureFileUri(result.uri) : inputUri;
    return finalUri;
  } catch (err) {
    console.warn('GeoTag stamping failed, using original image:', err);
    return ensureFileUri(imageUri);
  }
};

export const InstallationProofSection: React.FC<InstallationProofSectionProps> = ({
  station,
  currentVendor,
  onSuccess,
}) => {
  const [fileTypes, setFileTypes] = useState<VendorFileType[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState<boolean>(true);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileMap>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const [isDraftRestored, setIsDraftRestored] = useState<boolean>(false);
  const [geoTaggingId, setGeoTaggingId] = useState<number | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<ViewingPhotoInfo | null>(null);

  // Hardware serial numbers & switch firmware state
  const [switchSerialNumber, setSwitchSerialNumber] = useState<string>('');
  const [resilientSerialNumber, setResilientSerialNumber] = useState<string>('');
  const [switchFirmwareNumber, setSwitchFirmwareNumber] = useState<string>('');

  // Substation coordinates parsing & overall proximity calculation
  const subLat = parseFloat(String(station.Latitude || '').trim());
  const subLon = parseFloat(String(station.Longitude || '').trim());
  const hasSubCoords = !isNaN(subLat) && !isNaN(subLon) && (subLat !== 0 || subLon !== 0);

  const attachedPhotosWithGeo = Object.values(selectedFiles).filter(f => !!f.geoTag);
  const overallDistances = attachedPhotosWithGeo
    .map(f =>
      hasSubCoords
        ? calculateDistanceMeters(subLat, subLon, f.geoTag!.latitude, f.geoTag!.longitude)
        : null,
    )
    .filter((d): d is number => d !== null);

  const overallAvgDistance =
    overallDistances.length > 0
      ? Math.round(overallDistances.reduce((a, b) => a + b, 0) / overallDistances.length)
      : null;
  const isOverallWithin300m = overallAvgDistance !== null ? overallAvgDistance <= 300 : false;

  // Auto-populate stored photos and hardware drafts from SQLite immediately on mount
  useEffect(() => {
    let isMounted = true;
    getStationProofDraft(station.ExcelDataId, currentVendor.VendorId).then(draft => {
      if (isMounted && draft.hasDraft) {
        if (Object.keys(draft.photos).length > 0) {
          setSelectedFiles(draft.photos);
        }
        if (draft.switchSerialNumber) {
          setSwitchSerialNumber(draft.switchSerialNumber);
        }
        if (draft.resilientSerialNumber) {
          setResilientSerialNumber(draft.resilientSerialNumber);
        }
        if (draft.switchFirmwareNumber) {
          setSwitchFirmwareNumber(draft.switchFirmwareNumber);
        }
        setIsDraftRestored(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [station.ExcelDataId, currentVendor.VendorId]);

  const handleSwitchSerialChange = (text: string) => {
    setSwitchSerialNumber(text);
    saveDraftHardwareDetails(station.ExcelDataId, currentVendor.VendorId, {
      switchSerialNumber: text,
      resilientSerialNumber,
      switchFirmwareNumber,
    });
  };

  const handleResilientSerialChange = (text: string) => {
    setResilientSerialNumber(text);
    saveDraftHardwareDetails(station.ExcelDataId, currentVendor.VendorId, {
      switchSerialNumber,
      resilientSerialNumber: text,
      switchFirmwareNumber,
    });
  };

  const handleSwitchFirmwareChange = (text: string) => {
    setSwitchFirmwareNumber(text);
    saveDraftHardwareDetails(station.ExcelDataId, currentVendor.VendorId, {
      switchSerialNumber,
      resilientSerialNumber,
      switchFirmwareNumber: text,
    });
  };

  const handleUseAssignedSwitch = () => {
    if (station.SwitchSerialNumber) {
      handleSwitchSerialChange(station.SwitchSerialNumber.trim());
    }
  };

  const handleUseAssignedResilient = () => {
    if (station.ResilientSerialNumber) {
      handleResilientSerialChange(station.ResilientSerialNumber.trim());
    }
  };

  const switchSerialMatch = checkSerialMatch(
    switchSerialNumber,
    station.SwitchSerialNumber,
  );
  const resilientSerialMatch = checkSerialMatch(
    resilientSerialNumber,
    station.ResilientSerialNumber,
  );

  const hasAssignedSwitchSerial = Boolean(
    station.SwitchSerialNumber &&
      station.SwitchSerialNumber.trim() !== '' &&
      station.SwitchSerialNumber !== '-' &&
      station.SwitchSerialNumber.toUpperCase() !== 'N/A' &&
      station.SwitchSerialNumber.toUpperCase() !== 'NOT RECORDED',
  );

  const hasAssignedResilientSerial = Boolean(
    station.ResilientSerialNumber &&
      station.ResilientSerialNumber.trim() !== '' &&
      station.ResilientSerialNumber !== '-' &&
      station.ResilientSerialNumber.toUpperCase() !== 'N/A' &&
      station.ResilientSerialNumber.toUpperCase() !== 'NOT RECORDED',
  );

  useEffect(() => {
    let isMounted = true;
    const loadTypes = async () => {
      setIsLoadingTypes(true);
      try {
        const types = await apiService.fetchAssignStationDetailDropdown(2);
        if (isMounted && types && types.length > 0) {
          setFileTypes(types);
          saveCachedFileTypes(types); // Cache in SQLite for offline access
        }
      } catch (err) {
        console.warn('Network error fetching dropdown types, loading from SQLite cache:', err);
        // Fallback to SQLite cache irrespective of network
        const cached = await getCachedFileTypes();
        if (isMounted && cached && cached.length > 0) {
          setFileTypes(cached);
        }
      } finally {
        if (isMounted) setIsLoadingTypes(false);
      }
    };

    loadTypes();
    return () => {
      isMounted = false;
    };
  }, []);

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Access Needed',
          message: 'Please grant camera access to capture installation proof photos.',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('Camera permission request error:', err);
      return false;
    }
  };

  const requestLocationPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Access for Geo-Tagging',
          message: 'Location is used to embed GPS coordinates and address on your installation photos.',
          buttonNegative: 'Skip',
          buttonPositive: 'Allow',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('Location permission request error:', err);
      return false;
    }
  };

  const getCurrentLocation = (): Promise<{ latitude: number; longitude: number } | null> => {
    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        position => {
          resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude });
        },
        error => {
          console.warn('Geolocation error:', error.message);
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
      );
    });
  };

  const handleTakePhoto = async (type: VendorFileType) => {
    const hasPermission = await requestCameraPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
      return;
    }

    const options = {
      mediaType: 'photo' as const,
      quality: 0.8 as const,
      maxWidth: 1920,
      maxHeight: 1920,
      saveToPhotos: false,
    };

    launchCamera(options, async (response) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert('Camera Error', response.errorMessage);
        return;
      }
      if (response.assets && response.assets.length > 0) {
        const asset = response.assets[0];
        if (!asset.uri) return;

        // Show geo-tagging in progress
        setGeoTaggingId(type.VendorFileTypeId);

        try {
          const rawUri = ensureFileUri(asset.uri);
          const taggedAsset: TaggedAsset = { ...asset, uri: rawUri };
          const hasLocationPerm = await requestLocationPermission();

          if (hasLocationPerm) {
            const coords = await getCurrentLocation();
            if (coords) {
              const capturedAt = formatDateTime(new Date());
              const address = await reverseGeocode(coords.latitude, coords.longitude);
              const geoTag: GeoTag = { latitude: coords.latitude, longitude: coords.longitude, address, capturedAt };
              const taggedUri = await stampGeoTag(rawUri, geoTag);
              const safeTaggedUri = ensureFileUri(taggedUri);
              taggedAsset.taggedUri = safeTaggedUri;
              taggedAsset.uri = safeTaggedUri;
              taggedAsset.geoTag = geoTag;
            }
          }

          setSelectedFiles(prev => {
            const updatedFiles = { ...prev, [type.VendorFileTypeId]: taggedAsset };

            // Save geo-tagged version to SQLite draft (with embedded address & time & hardware serials)
            saveDraftPhoto(
              station.ExcelDataId,
              currentVendor.VendorId,
              type.VendorFileTypeId,
              type.VendorFileTypeName,
              taggedAsset,
              {
                switchSerialNumber,
                resilientSerialNumber,
                switchFirmwareNumber,
              },
            );

            // Automatically record 300m geo-fence proximity remarks in SQLite draft in background
            const autoRemarks = buildAutomaticRemarks(station, updatedFiles);
            saveDraftRemarks(station.ExcelDataId, currentVendor.VendorId, autoRemarks);

            return updatedFiles;
          });
        } finally {
          setGeoTaggingId(null);
        }
      }
    });
  };

  const handleRemoveFile = (fileTypeId: number) => {
    setSelectedFiles(prev => {
      const updated = { ...prev };
      delete updated[fileTypeId];
      // Automatically update background remarks in SQLite draft
      const autoRemarks = buildAutomaticRemarks(station, updated);
      saveDraftRemarks(station.ExcelDataId, currentVendor.VendorId, autoRemarks);
      return updated;
    });
    // Immediately remove from SQLite database
    removeDraftPhoto(station.ExcelDataId, currentVendor.VendorId, fileTypeId);
  };

  const performSubmission = async (selectedIds: number[]) => {
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      // 1. Prepare structured file items (use geo-tagged URI if available)
      const submissionFiles: OfflineSubmissionFile[] = [];
      selectedIds.forEach((fileTypeId) => {
        const asset = selectedFiles[fileTypeId];
        if (asset) {
          const fileUri = asset.taggedUri || asset.uri;
          if (!fileUri) return;
          const matchedType = fileTypes.find(t => t.VendorFileTypeId === fileTypeId);
          const fileExtension = asset.fileName ? asset.fileName.split('.').pop() : 'jpg';
          const fileName = `proof_${fileTypeId}_${Date.now()}.${fileExtension || 'jpg'}`;
          submissionFiles.push({
            uri: fileUri,
            name: fileName,
            type: asset.type || 'image/jpeg',
            fileTypeId,
            fileTypeName: matchedType?.VendorFileTypeName || `File #${fileTypeId}`,
            size: asset.fileSize,
          });
        }
      });

      // Automated 300m geo-fence verification remarks
      const submissionRemarks = buildAutomaticRemarks(station, selectedFiles);
      const createdBy =
        currentVendor.CreatedByUserName ||
        currentVendor.ContactPerson ||
        currentVendor.VendorName ||
        'Vendor';

      const routeStationStatusId = Number(
        station.RouteStationStatusId || (station as any).routeStationStatusId || 0,
      );

      // 2. Check current network connectivity
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected === true && netState.isInternetReachable !== false;

      if (isOnline) {
        // --- ONLINE: DIRECT API SUBMISSION ---
        try {
          const formData = new FormData();
          formData.append('ExcelDataId', String(station.ExcelDataId));
          formData.append('VendorId', String(currentVendor.VendorId));
          formData.append('Remarks', submissionRemarks);
          formData.append('CreatedByUserName', createdBy);
          formData.append('flagId', '2');
          formData.append('FileTypeId', JSON.stringify(selectedIds));
          formData.append('SwitchSerialNumber', switchSerialNumber.trim());
          formData.append('ResilientSerialNumber', resilientSerialNumber.trim());
          formData.append('SwitchFirmWareNumber', switchFirmwareNumber.trim());
          formData.append('RouteStationStatusId', String(routeStationStatusId));

          submissionFiles.forEach(file => {
            formData.append('files', {
              uri: Platform.OS === 'android' ? file.uri : file.uri.replace('file://', ''),
              name: file.name,
              type: file.type,
            } as any);
          });

          const response = await apiService.createInstallationSubmission(formData);

          // Flush draft from SQLite and flush screen state
          await clearStationProofDraft(station.ExcelDataId, currentVendor.VendorId);
          setSelectedFiles({});
          setSwitchSerialNumber('');
          setResilientSerialNumber('');
          setSwitchFirmwareNumber('');

          Alert.alert(
            'Submission Successful! 🎉',
            response.message || 'Installation proof has been submitted successfully to RNA cloud.',
            [
              {
                text: 'Great',
                onPress: () => onSuccess(),
              },
            ],
          );
          return;
        } catch (apiErr: any) {
          console.warn('Direct API submission failed:', apiErr);
          const errStr = String(apiErr?.message || '').toLowerCase();
          const isNetworkError =
            errStr.includes('network request failed') ||
            errStr.includes('failed to connect') ||
            errStr.includes('timeout') ||
            errStr.includes('abort');
          if (!isNetworkError) {
            Alert.alert('Submission Error', apiErr?.message || 'Server rejected the submission.');
            return;
          }
          // Only fallback to storing in local SQLite if it was an actual network disconnect
        }
      }

      // --- OFFLINE (or API network fallback): STORE EVERYTHING IN LOCAL SQLITE DB ---
      const queueRes = await queueOfflineSubmission({
        excelDataId: station.ExcelDataId,
        stationName: station.Station,
        voltageClass: station.VoltageClass || '',
        vendorId: currentVendor.VendorId,
        remarks: submissionRemarks,
        createdByUserName: createdBy,
        flagId: '2',
        fileTypeIds: selectedIds,
        files: submissionFiles,
        switchSerialNumber: switchSerialNumber.trim(),
        resilientSerialNumber: resilientSerialNumber.trim(),
        switchFirmwareNumber: switchFirmwareNumber.trim(),
        routeStationStatusId,
      });

      if (queueRes.success) {
        // Flush draft from SQLite and flush screen state
        await clearStationProofDraft(station.ExcelDataId, currentVendor.VendorId);
        setSelectedFiles({});
        setSwitchSerialNumber('');
        setResilientSerialNumber('');
        setSwitchFirmwareNumber('');

        Alert.alert(
          'Stored in Local DB! 📁',
          `No internet connection detected. Everything required for the submission (including hardware serials, firmware, and RouteStationStatusId) has been stored securely in the local SQLite database.\n\nIt will trigger for submission automatically once online or every 4 hours in the background. You can also view and trigger it anytime from the Offline Queue screen.`,
          [
            {
              text: 'OK',
              onPress: () => onSuccess(),
            },
          ],
        );
      } else {
        Alert.alert(
          'Database Error',
          queueRes.error || 'Unable to store submission locally.',
        );
      }
    } catch (err: any) {
      Alert.alert('Submission Error', err.message || 'An unexpected error occurred.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    // Instant synchronous check to prevent double-tap submissions
    if (isSubmittingRef.current || isSubmitting) {
      console.log('Submission already in progress, ignoring duplicate tap.');
      return;
    }

    const selectedIds = Object.keys(selectedFiles).map(id => Number(id));
    if (selectedIds.length === 0) {
      Alert.alert(
        'Photo Required',
        'Please upload at least one installation proof photo before submitting.',
      );
      return;
    }

    if (!switchSerialNumber.trim()) {
      Alert.alert(
        'Missing Switch Serial Number',
        'Please enter the Switch Serial Number before submitting.',
      );
      return;
    }

    if (!resilientSerialNumber.trim()) {
      Alert.alert(
        'Missing Resilient Serial Number',
        'Please enter the Resilient Serial Number before submitting.',
      );
      return;
    }

    if (!switchFirmwareNumber.trim()) {
      Alert.alert(
        'Missing Switch Firmware Version',
        'Please enter the Switch Firmware Number before submitting.',
      );
      return;
    }

    // Comparison check against assigned records
    const swMatch = checkSerialMatch(switchSerialNumber, station.SwitchSerialNumber);
    const resMatch = checkSerialMatch(resilientSerialNumber, station.ResilientSerialNumber);

    const mismatches: string[] = [];
    if (swMatch.status === 'mismatch') {
      mismatches.push(
        `• Switch S/N: Entered "${switchSerialNumber.trim()}" vs Assigned "${station.SwitchSerialNumber}"`,
      );
    }
    if (resMatch.status === 'mismatch') {
      mismatches.push(
        `• Resilient S/N: Entered "${resilientSerialNumber.trim()}" vs Assigned "${station.ResilientSerialNumber}"`,
      );
    }

    if (mismatches.length > 0) {
      Alert.alert(
        'Serial Number Mismatch ⚠️',
        `The following serial numbers do not match the assigned station records:\n\n${mismatches.join(
          '\n',
        )}\n\nDo you want to proceed with this submission?`,
        [
          { text: 'Review & Edit', style: 'cancel' },
          {
            text: 'Proceed Anyway',
            onPress: () => {
              if (isSubmittingRef.current) return;
              isSubmittingRef.current = true;
              performSubmission(selectedIds);
            },
          },
        ],
      );
      return;
    }

    isSubmittingRef.current = true;
    await performSubmission(selectedIds);
  };

  const uploadedCount = Object.keys(selectedFiles).length;
  const totalCount = fileTypes.length;

  return (
    <View style={styles.container}>
      <View style={styles.headerBox}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.sectionTitle}>📸 Installation Proof Upload</Text>
          <View style={styles.progressBadge}>
            <Text style={styles.progressText}>
              {uploadedCount} / {totalCount} Attached
            </Text>
          </View>
        </View>
        <Text style={styles.subtitle}>
          Capture live photo proof for each equipment. GPS coordinates, address &amp; timestamp will be automatically embedded on each photo.
        </Text>

        {/* Geo-Tag Banner */}
       

        {/* SQLite Draft Persistence Status Pill */}
        {/* <View style={styles.sqliteDraftPill}>
          <Text style={styles.sqliteDraftIcon}>💾</Text>
          <Text style={styles.sqliteDraftText}>
            {isDraftRestored
              ? 'Draft auto-populated from SQLite database'
              : uploadedCount > 0 || remarks.trim().length > 0
                ? 'All photos & remarks stored immediately in SQLite'
                : 'All captured photos & remarks auto-save to SQLite immediately'}
          </Text>
        </View> */}
      </View>

      {isLoadingTypes ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#2563EB" />
          <Text style={styles.loadingText}>Loading required photo types...</Text>
        </View>
      ) : (
        <View style={styles.typesList}>
          {fileTypes.map(type => {
            const file = selectedFiles[type.VendorFileTypeId];
            const isUploaded = !!file;
            const isTagging = geoTaggingId === type.VendorFileTypeId;
            const displayUri = ensureFileUri(file?.taggedUri || file?.uri);
            const photoProximity = file?.geoTag
              ? checkSubstationProximity(
                  station.Latitude,
                  station.Longitude,
                  file.geoTag.latitude,
                  file.geoTag.longitude,
                )
              : null;

            const handleOpenModal = () => {
              if (!displayUri || !file) return;
              setViewingPhoto({
                uri: displayUri,
                typeName: type.VendorFileTypeName,
                fileTypeId: type.VendorFileTypeId,
                fileName: file.fileName,
                fileSize: file.fileSize,
                geoTag: file.geoTag,
                distanceMeters: photoProximity?.distanceMeters,
                isWithin300m: photoProximity?.isWithin300m,
              });
            };

            return (
              <View
                key={type.VendorFileTypeId}
                style={[
                  styles.typeCard,
                  isUploaded ? styles.typeCardUploaded : null,
                ]}>
                <View style={styles.typeCardHeader}>
                  <View style={styles.typeTitleWrap}>
                    <Text style={styles.typeNumber}>#{type.VendorFileTypeId}</Text>
                    <Text style={styles.typeName}>{type.VendorFileTypeName}</Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      isTagging
                        ? styles.statusPillTagging
                        : isUploaded
                          ? styles.statusPillUploaded
                          : styles.statusPillPending,
                    ]}>
                    <Text
                      style={[
                        styles.statusPillText,
                        isTagging
                          ? styles.statusTextTagging
                          : isUploaded
                            ? styles.statusTextUploaded
                            : styles.statusTextPending,
                      ]}>
                      {isTagging ? '🛰️ Geo-Tagging...' : isUploaded ? '✓ Attached' : 'Pending'}
                    </Text>
                  </View>
                </View>

                {isTagging ? (
                  <View style={styles.geoTaggingOverlay}>
                    <ActivityIndicator size="small" color="#7C3AED" />
                    <Text style={styles.geoTaggingText}>Getting GPS &amp; stamping photo...</Text>
                  </View>
                ) : isUploaded && displayUri ? (
                  <View style={styles.previewContainer}>
                    <TouchableOpacity
                      style={styles.previewImageTouchable}
                      activeOpacity={0.8}
                      onPress={handleOpenModal}>
                      <Image
                        source={{ uri: displayUri }}
                        style={styles.previewImage}
                        resizeMode="cover"
                        onError={e => console.warn('Preview image load error:', e.nativeEvent.error)}
                      />
                      <View style={styles.viewBadge}>
                        <Text style={styles.viewBadgeText}>🔍 View</Text>
                      </View>
                      {file.geoTag && (
                        <View style={styles.geoTagStampOverlay}>
                          <Text style={styles.geoTagStampText}>📍 Geo-Tagged</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    <View style={styles.previewMeta}>
                      <Text style={styles.fileNameText} numberOfLines={1}>
                        {file.fileName || `${type.VendorFileTypeName}.jpg`}
                      </Text>
                      {file.fileSize ? (
                        <Text style={styles.fileSizeText}>
                          {(file.fileSize / 1024).toFixed(1)} KB
                        </Text>
                      ) : null}
                      {/* Geo-tag info display with 300m radius validation */}
                      {/* {file.geoTag && (
                        <View style={styles.geoTagInfoBox}>
                          <Text style={styles.geoTagInfoLine} numberOfLines={2}>
                            📍 {file.geoTag.address}
                          </Text>
                          <Text style={styles.geoTagInfoLine}>
                            🌐 {file.geoTag.latitude.toFixed(5)}°, {file.geoTag.longitude.toFixed(5)}°
                          </Text>
                          <Text style={styles.geoTagInfoLine}>
                            🕐 {file.geoTag.capturedAt}
                          </Text>
                          {photoProximity && photoProximity.hasSubstationCoords && (
                            <View
                              style={[
                                styles.proximityBadge,
                                photoProximity.isWithin300m
                                  ? styles.proximityBadgeWithin
                                  : styles.proximityBadgeOutside,
                              ]}>
                              <Text
                                style={[
                                  styles.proximityBadgeText,
                                  photoProximity.isWithin300m
                                    ? styles.proximityTextWithin
                                    : styles.proximityTextOutside,
                                ]}>
                                {photoProximity.isWithin300m
                                  ? `✓ Within 300m (${photoProximity.distanceMeters}m from substation)`
                                  : `⚠️ Outside 300m (${photoProximity.distanceMeters}m from substation)`}
                              </Text>
                            </View>
                          )}
                        </View>
                      )} */}
                      <View style={styles.fileActionRow}>
                        <TouchableOpacity
                          style={styles.viewBtn}
                          onPress={handleOpenModal}
                          activeOpacity={0.7}>
                          <Text style={styles.viewBtnText}>👁️ View Photo</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.changeBtn}
                          onPress={() => handleTakePhoto(type)}
                          activeOpacity={0.7}>
                          <Text style={styles.changeBtnText}>📷 Retake</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleRemoveFile(type.VendorFileTypeId)}
                          activeOpacity={0.7}>
                          <Text style={styles.removeBtnText}>✕ Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.actionBtnCamera}
                    onPress={() => handleTakePhoto(type)}
                    activeOpacity={0.75}>
                    <Text style={styles.actionBtnCameraText}>📷 Take Photo</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Hardware Serial Numbers Verification & Firmware Card */}
      <View style={styles.hardwareCard}>
        <View style={styles.hardwareCardHeader}>
          <View style={styles.hardwareHeaderTitleRow}>
            <Text style={styles.hardwareCardTitle}>⚡ Hardware Verification &amp; Firmware</Text>
            {station.RouteStationStatusId ? (
              <View style={styles.routeStatusBadge}>
                <Text style={styles.routeStatusBadgeText}>
                  Route Status #{station.RouteStationStatusId}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.hardwareCardSub}>
            Verify equipment serial numbers against assigned records and enter the active switch firmware version.
          </Text>
        </View>

        {/* 1. Switch Serial Number */}
        <View style={styles.hardwareInputGroup}>
          <View style={styles.hardwareLabelRow}>
            <Text style={styles.hardwareLabel}>
              Switch Serial Number <Text style={styles.requiredStar}>*</Text>
            </Text>
            {hasAssignedSwitchSerial && (
              <TouchableOpacity
                style={styles.copyAssignedBtn}
                onPress={handleUseAssignedSwitch}
                activeOpacity={0.7}>
                <Text style={styles.copyAssignedBtnText}>Use Assigned</Text>
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            style={[
              styles.hardwareInput,
              switchSerialMatch.status === 'match'
                ? styles.inputBorderSuccess
                : switchSerialMatch.status === 'mismatch'
                  ? styles.inputBorderWarning
                  : null,
            ]}
            placeholder={
              station.SwitchSerialNumber
                ? `Assigned: ${station.SwitchSerialNumber}`
                : 'Enter Switch Serial No. (e.g. 2660H2515XLH)'
            }
            placeholderTextColor="#94A3B8"
            value={switchSerialNumber}
            onChangeText={handleSwitchSerialChange}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {/* Comparison Status Indicator */}
          <View
            style={[
              styles.comparisonPill,
              switchSerialMatch.status === 'match'
                ? styles.comparisonPillMatch
                : switchSerialMatch.status === 'mismatch'
                  ? styles.comparisonPillMismatch
                  : styles.comparisonPillNeutral,
            ]}>
            <Text
              style={[
                styles.comparisonPillText,
                switchSerialMatch.status === 'match'
                  ? styles.comparisonTextMatch
                  : switchSerialMatch.status === 'mismatch'
                    ? styles.comparisonTextMismatch
                    : styles.comparisonTextNeutral,
              ]}>
              {switchSerialMatch.message}
            </Text>
          </View>
        </View>

        {/* 2. Resilient Serial Number */}
        <View style={styles.hardwareInputGroup}>
          <View style={styles.hardwareLabelRow}>
            <Text style={styles.hardwareLabel}>
              Resilient Serial Number <Text style={styles.requiredStar}>*</Text>
            </Text>
            {hasAssignedResilientSerial && (
              <TouchableOpacity
                style={styles.copyAssignedBtn}
                onPress={handleUseAssignedResilient}
                activeOpacity={0.7}>
                <Text style={styles.copyAssignedBtnText}>Use Assigned</Text>
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            style={[
              styles.hardwareInput,
              resilientSerialMatch.status === 'match'
                ? styles.inputBorderSuccess
                : resilientSerialMatch.status === 'mismatch'
                  ? styles.inputBorderWarning
                  : null,
            ]}
            placeholder={
              station.ResilientSerialNumber
                ? `Assigned: ${station.ResilientSerialNumber}`
                : 'Enter Resilient Serial No. (e.g. 202607310903)'
            }
            placeholderTextColor="#94A3B8"
            value={resilientSerialNumber}
            onChangeText={handleResilientSerialChange}
            autoCapitalize="characters"
            autoCorrect={false}
          />
          {/* Comparison Status Indicator */}
          <View
            style={[
              styles.comparisonPill,
              resilientSerialMatch.status === 'match'
                ? styles.comparisonPillMatch
                : resilientSerialMatch.status === 'mismatch'
                  ? styles.comparisonPillMismatch
                  : styles.comparisonPillNeutral,
            ]}>
            <Text
              style={[
                styles.comparisonPillText,
                resilientSerialMatch.status === 'match'
                  ? styles.comparisonTextMatch
                  : resilientSerialMatch.status === 'mismatch'
                    ? styles.comparisonTextMismatch
                    : styles.comparisonTextNeutral,
              ]}>
              {resilientSerialMatch.message}
            </Text>
          </View>
        </View>

        {/* 3. Switch Firmware Number */}
        <View style={styles.hardwareInputGroup}>
          <View style={styles.hardwareLabelRow}>
            <Text style={styles.hardwareLabel}>
              Switch Firmware Version / Number <Text style={styles.requiredStar}>*</Text>
            </Text>
          </View>
          <TextInput
            style={styles.hardwareInput}
            placeholder="e.g. 22aa, v2.1.0, FW-2026"
            placeholderTextColor="#94A3B8"
            value={switchFirmwareNumber}
            onChangeText={handleSwitchFirmwareChange}
            autoCorrect={false}
          />
          <Text style={styles.firmwareHelperText}>
            ℹ️ Enter the firmware version running on the hardware switch.
          </Text>
        </View>
      </View>

      {/* Substation Proximity & Auto Remarks Card (replaces manual remarks field) */}
      <View style={styles.autoAuditCard}>
        <View style={styles.autoAuditHeader}>
          <Text style={styles.autoAuditTitle}>📍 Substation Proximity &amp; Audit Status</Text>
          <View
            style={[
              styles.autoAuditStatusPill,
              !hasSubCoords
                ? styles.autoAuditPillNeutral
                : isOverallWithin300m
                  ? styles.autoAuditPillSuccess
                  : styles.autoAuditPillWarning,
            ]}>
            <Text
              style={[
                styles.autoAuditStatusText,
                !hasSubCoords
                  ? styles.autoAuditTextNeutral
                  : isOverallWithin300m
                    ? styles.autoAuditTextSuccess
                    : styles.autoAuditTextWarning,
              ]}>
              {!hasSubCoords
                ? 'No Substation GPS'
                : isOverallWithin300m
                  ? '✓ Verified <300m'
                  : '⚠️ Outside 300m'}
            </Text>
          </View>
        </View>

        {hasSubCoords ? (
          <View style={styles.autoAuditDetailRow}>
            <Text style={styles.autoAuditCoordsText}>
              Substation GPS: {subLat.toFixed(5)}°, {subLon.toFixed(5)}°
            </Text>
            {overallAvgDistance !== null && (
              <Text style={styles.autoAuditDistanceText}>
                Distance: {overallAvgDistance}m {isOverallWithin300m ? '(Inside 300m)' : '(Exceeds 300m)'}
              </Text>
            )}
          </View>
        ) : (
          <Text style={styles.autoAuditNoticeText}>
            Substation coordinates not provided in system. Captured photo GPS will be logged directly.
          </Text>
        )}

        <View style={styles.autoAuditFooterRow}>
          <Text style={styles.autoAuditNoteText}>
            🤖 Audit remarks are generated and validated automatically in the background.
          </Text>
          {uploadedCount > 0 && (
            <Text style={styles.autoAuditSavedText}>✓ SQLite Auto-Draft</Text>
          )}
        </View>
      </View>

      {/* Submit Button */}
      <TouchableOpacity
        style={[
          styles.submitButton,
          uploadedCount === 0 || isSubmitting ? styles.submitButtonDisabled : null,
        ]}
        onPress={handleSubmit}
        disabled={uploadedCount === 0 || isSubmitting}
        activeOpacity={0.85}>
        {isSubmitting ? (
          <View style={styles.submitRow}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.submitButtonText}>Submitting Installation Proof...</Text>
          </View>
        ) : (
          <Text style={styles.submitButtonText}>
            📤 Submit Installation Proof ({uploadedCount}/{totalCount})
          </Text>
        )}
      </TouchableOpacity>

      {/* Full-Screen Photo Viewer Modal */}
      <Modal
        visible={!!viewingPhoto}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setViewingPhoto(null)}>
        <View style={styles.viewerModalContainer}>
          {/* Header Bar */}
          <View style={styles.viewerHeader}>
            <View style={styles.viewerTitleWrap}>
              <Text style={styles.viewerTitle} numberOfLines={1}>
                {viewingPhoto?.typeName || 'Installation Photo'}
              </Text>
              <Text style={styles.viewerSubtitle} numberOfLines={1}>
                {station.Station} • #{viewingPhoto?.fileTypeId}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.viewerCloseBtn}
              onPress={() => setViewingPhoto(null)}
              activeOpacity={0.8}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.viewerCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Photo Body */}
          <View style={styles.viewerBody}>
            {viewingPhoto && (
              <Image
                source={{ uri: ensureFileUri(viewingPhoto.uri) }}
                style={styles.viewerFullImage}
                resizeMode="contain"
                onError={e => console.warn('Modal image load error:', e.nativeEvent.error)}
              />
            )}
          </View>

          {/* Details & Geo-Tag Overlay Footer */}
          <View style={styles.viewerFooter}>
            {viewingPhoto?.geoTag && (
              <View style={styles.viewerGeoTagBox}>
                <View style={styles.viewerGeoTagHeader}>
                  <Text style={styles.viewerGeoTagTitle}>📍 Geo-Tag Verification</Text>
                  {viewingPhoto.distanceMeters !== undefined && viewingPhoto.distanceMeters !== null ? (
                    <View
                      style={[
                        styles.viewerRadiusBadge,
                        viewingPhoto.isWithin300m
                          ? styles.viewerRadiusBadgeWithin
                          : styles.viewerRadiusBadgeOutside,
                      ]}>
                      <Text
                        style={[
                          styles.viewerRadiusBadgeText,
                          viewingPhoto.isWithin300m
                            ? styles.viewerRadiusTextWithin
                            : styles.viewerRadiusTextOutside,
                        ]}>
                        {viewingPhoto.isWithin300m
                          ? `✓ ${viewingPhoto.distanceMeters}m (Within 300m)`
                          : `⚠️ ${viewingPhoto.distanceMeters}m (Outside 300m)`}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.viewerLiveBadge}>
                      <Text style={styles.viewerLiveBadgeText}>Watermarked</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.viewerGeoTagAddress} numberOfLines={2}>
                  {viewingPhoto.geoTag.address}
                </Text>
                <View style={styles.viewerGeoTagRow}>
                  <Text style={styles.viewerGeoTagCoords}>
                    🌐 {viewingPhoto.geoTag.latitude.toFixed(6)}°, {viewingPhoto.geoTag.longitude.toFixed(6)}°
                  </Text>
                  <Text style={styles.viewerGeoTagTime}>
                    🕐 {viewingPhoto.geoTag.capturedAt}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.viewerFileMetaRow}>
              <Text style={styles.viewerFileName} numberOfLines={1}>
                📁 {viewingPhoto?.fileName || `${viewingPhoto?.typeName}.jpg`}
              </Text>
              {viewingPhoto?.fileSize ? (
                <Text style={styles.viewerFileSize}>
                  {(viewingPhoto.fileSize / 1024).toFixed(1)} KB
                </Text>
              ) : null}
            </View>

            <TouchableOpacity
              style={styles.viewerDismissButton}
              onPress={() => setViewingPhoto(null)}
              activeOpacity={0.85}>
              <Text style={styles.viewerDismissButtonText}>Done Viewing</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  headerBox: {
    marginBottom: 14,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  progressBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563EB',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },
  typesList: {
    gap: 12,
  },
  typeCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  typeCardUploaded: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  typeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  typeTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  typeNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: '#94A3B8',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    flexShrink: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusPillPending: {
    backgroundColor: '#FEF3C7',
  },
  statusPillUploaded: {
    backgroundColor: '#DCFCE7',
  },
  statusPillTagging: {
    backgroundColor: '#EDE9FE',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextPending: {
    color: '#B45309',
  },
  statusTextUploaded: {
    color: '#15803D',
  },
  statusTextTagging: {
    color: '#6D28D9',
  },
  geoTaggingOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    backgroundColor: '#F5F3FF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  geoTaggingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7C3AED',
  },
  actionBtnCamera: {
    backgroundColor: '#2563EB',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnCameraText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  previewContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'flex-start',
    gap: 12,
  },
  previewImageTouchable: {
    position: 'relative',
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  previewImage: {
    width: 86,
    height: 86,
    borderRadius: 7,
    backgroundColor: '#E2E8F0',
  },
  viewBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  viewBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  geoTagStampOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#00000099',
    paddingVertical: 2,
    alignItems: 'center',
  },
  geoTagStampText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  previewMeta: {
    flex: 1,
  },
  fileNameText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  fileSizeText: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 4,
  },
  geoTagInfoBox: {
    backgroundColor: '#F5F3FF',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    marginBottom: 8,
    gap: 2,
    borderWidth: 1,
    borderColor: '#EDE9FE',
  },
  geoTagInfoLine: {
    fontSize: 10,
    color: '#5B21B6',
    fontWeight: '500',
    lineHeight: 14,
  },
  fileActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  viewBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  viewBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  changeBtn: {
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  changeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  removeBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  removeBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#EF4444',
  },
  viewerModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    justifyContent: 'space-between',
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'android' ? Math.max((StatusBar.currentHeight || 0) + 16, 52) : 56,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  viewerTitleWrap: {
    flex: 1,
    marginRight: 12,
  },
  viewerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  viewerSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  viewerCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCloseText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  viewerBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  viewerFullImage: {
    width: '100%',
    height: '100%',
  },
  viewerFooter: {
    padding: 16,
    paddingBottom: Platform.OS === 'android' ? 24 : 36,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
    gap: 10,
  },
  viewerGeoTagBox: {
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.35)',
    padding: 12,
    gap: 6,
  },
  viewerGeoTagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewerGeoTagTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#DDD6FE',
  },
  viewerLiveBadge: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  viewerLiveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  viewerGeoTagAddress: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
    lineHeight: 18,
  },
  viewerGeoTagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  viewerGeoTagCoords: {
    fontSize: 12,
    fontWeight: '600',
    color: '#86EFAC',
  },
  viewerGeoTagTime: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FDE68A',
  },
  viewerFileMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  viewerFileName: {
    fontSize: 12,
    color: '#94A3B8',
    flex: 1,
  },
  viewerFileSize: {
    fontSize: 12,
    fontWeight: '600',
    color: '#CBD5E1',
    marginLeft: 8,
  },
  viewerDismissButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  viewerDismissButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  proximityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  proximityBadgeWithin: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  proximityBadgeOutside: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  proximityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  proximityTextWithin: {
    color: '#047857',
  },
  proximityTextOutside: {
    color: '#DC2626',
  },
  viewerRadiusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  viewerRadiusBadgeWithin: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderColor: '#10B981',
  },
  viewerRadiusBadgeOutside: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#EF4444',
  },
  viewerRadiusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  viewerRadiusTextWithin: {
    color: '#34D399',
  },
  viewerRadiusTextOutside: {
    color: '#F87171',
  },
  autoAuditCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 6,
  },
  autoAuditHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  autoAuditTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  autoAuditStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  autoAuditPillSuccess: {
    backgroundColor: '#DCFCE7',
  },
  autoAuditPillWarning: {
    backgroundColor: '#FEE2E2',
  },
  autoAuditPillNeutral: {
    backgroundColor: '#F1F5F9',
  },
  autoAuditStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  autoAuditTextSuccess: {
    color: '#15803D',
  },
  autoAuditTextWarning: {
    color: '#B91C1C',
  },
  autoAuditTextNeutral: {
    color: '#64748B',
  },
  autoAuditDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  autoAuditCoordsText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  autoAuditDistanceText: {
    fontSize: 11,
    color: '#0F172A',
    fontWeight: '700',
  },
  autoAuditNoticeText: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },
  autoAuditFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  autoAuditNoteText: {
    fontSize: 10,
    color: '#64748B',
    flex: 1,
  },
  autoAuditSavedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#059669',
    marginLeft: 8,
  },
  geoTagBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
    gap: 10,
  },
  geoTagBannerIcon: {
    fontSize: 22,
  },
  geoTagBannerText: {
    flex: 1,
  },
  geoTagBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5B21B6',
  },
  geoTagBannerSub: {
    fontSize: 11,
    color: '#7C3AED',
    lineHeight: 15,
  },
  sqliteDraftPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
    gap: 6,
  },
  sqliteDraftIcon: {
    fontSize: 14,
  },
  sqliteDraftText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#15803D',
    flex: 1,
  },
  hardwareCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  hardwareCardHeader: {
    marginBottom: 12,
  },
  hardwareHeaderTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  hardwareCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  hardwareCardSub: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
  },
  routeStatusBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  routeStatusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338CA',
  },
  hardwareInputGroup: {
    marginTop: 10,
  },
  hardwareLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  hardwareLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  requiredStar: {
    color: '#EF4444',
  },
  copyAssignedBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  copyAssignedBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
  hardwareInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  inputBorderSuccess: {
    borderColor: '#10B981',
    backgroundColor: '#F0FDF4',
  },
  inputBorderWarning: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  comparisonPill: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  comparisonPillMatch: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  comparisonPillMismatch: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  comparisonPillNeutral: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  comparisonPillText: {
    fontSize: 12,
  },
  comparisonTextMatch: {
    color: '#15803D',
    fontWeight: '700',
  },
  comparisonTextMismatch: {
    color: '#B45309',
    fontWeight: '700',
  },
  comparisonTextNeutral: {
    color: '#64748B',
    fontWeight: '600',
  },
  firmwareHelperText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 15,
  },
  submitButton: {
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  submitButtonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
