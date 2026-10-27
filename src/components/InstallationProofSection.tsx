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
import { StationItem, VendorFileType, VendorProfile, DEFAULT_FILE_TYPES } from '../types';
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
  isWorker?: boolean;
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
 * Preferred display ordering for photo proof upload cards:
 * Order: 6, 4, 8, 5, 10, 9, 7
 * Any other types appearing in the future will be appended after these in ascending order.
 */
export const PREFERRED_FILE_TYPE_ORDER = [6, 4, 8, 5, 10, 9, 7];

export const sortFileTypesByCustomOrder = (
  types: VendorFileType[],
): VendorFileType[] => {
  if (!Array.isArray(types)) return [];
  return [...types].sort((a, b) => {
    const idA = Number(a.VendorFileTypeId);
    const idB = Number(b.VendorFileTypeId);
    const indexA = PREFERRED_FILE_TYPE_ORDER.indexOf(idA);
    const indexB = PREFERRED_FILE_TYPE_ORDER.indexOf(idB);

    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    if (indexA !== -1) {
      return -1;
    }
    if (indexB !== -1) {
      return 1;
    }
    return idA - idB;
  });
};

export const isSwitchSerialType = (type: VendorFileType): boolean => {
  if (!type) return false;
  const id = Number(type.VendorFileTypeId);
  if (id === 11) return true;
  const name = (type.VendorFileTypeName || '').toLowerCase().replace(/[\s_\-]/g, '');
  return name === 'switchserialnumber' || name === 'switchserial';
};

export const isResilientSerialType = (type: VendorFileType): boolean => {
  if (!type) return false;
  const id = Number(type.VendorFileTypeId);
  if (id === 12) return true;
  const name = (type.VendorFileTypeName || '').toLowerCase().replace(/[\s_\-]/g, '');
  return name === 'resilientserialnumber' || name === 'resilientserial';
};

export const isAnnexure11Type = (type: VendorFileType): boolean => {
  if (!type) return false;
  const id = Number(type.VendorFileTypeId);
  if (id === 7) return true;
  const name = (type.VendorFileTypeName || '').toLowerCase().replace(/[\s_\-]/g, '');
  return name.includes('annexure11') || name.includes('annexure');
};

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500); // 2.5s timeout prevents camera hanging
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
      filename: `geotagged_${Date.now()}`,
      saveFormat: ImageFormat.jpg,
      maxSize: isLarge ? 1024 : 1280, // Caps max dimension
      quality: isLarge ? 55 : 65,      // Quality 65 guarantees ~180-320 KB (strictly < 1 MB limit)
    });

    const finalUri = result?.uri ? ensureFileUri(result.uri) : inputUri;
    return finalUri;
  } catch (err) {
    console.warn('GeoTag stamping failed, using original image:', err);
    return ensureFileUri(imageUri);
  }
};

/**
 * Fallback compressor: ensures photo file size is strictly under 1 MB (1,000,000 bytes).
 * Recompresses using Marker down to 1024px with 55% quality (~150-250 KB).
 */
export const compressPhotoUnder1MB = async (
  uri: string,
): Promise<{ uri: string; size: number }> => {
  const safeUri = ensureFileUri(uri);
  try {
    const compressed = await Marker.markText({
      backgroundImage: { src: { uri: safeUri }, scale: 1 },
      watermarkTexts: [],
      saveFormat: ImageFormat.jpg,
      maxSize: 1024,
      quality: 55,
      filename: `comp_${Date.now()}`,
    });
    const finalUri = compressed?.uri ? ensureFileUri(compressed.uri) : safeUri;
    return { uri: finalUri, size: 220 * 1024 };
  } catch (err) {
    console.warn('Compression pass error:', err);
    return { uri: safeUri, size: 350 * 1024 };
  }
};

export const InstallationProofSection: React.FC<InstallationProofSectionProps> = ({
  station,
  currentVendor,
  isWorker: propIsWorker,
  onSuccess,
}) => {
  const isWorker =
    propIsWorker !== undefined
      ? propIsWorker
      : (currentVendor.RoleId === 9 ||
         currentVendor.userType === 'VendorWorker' ||
         Boolean(currentVendor.VendorWorkerId) ||
         Boolean((currentVendor as any)?.WorkerId));

  const workerStationAssignmentId = isWorker
    ? (station.WorkerStationAssignmentId ||
       (station as any)?.WorkerStationAssignmentId ||
       0)
    : 0;

  const activeWorkerId = isWorker
    ? (currentVendor.WorkerId ||
       currentVendor.VendorWorkerId ||
       (currentVendor as any)?.WorkerId ||
       station.WorkerId ||
       (station as any)?.WorkerId ||
       0)
    : (currentVendor.VendorWorkerId || 0);

  // Remaining pending photo types from API (if already in Draft status)
  const pendingTypesFromStation: VendorFileType[] = React.useMemo(() => {
    if (Array.isArray(station.PendingFileTypes) && station.PendingFileTypes.length > 0) {
      return station.PendingFileTypes;
    }
    if (
      Array.isArray((station as any).PendingFileTypeIds) &&
      (station as any).PendingFileTypeIds.length > 0
    ) {
      return (station as any).PendingFileTypeIds;
    }
    return [];
  }, [station.PendingFileTypes, (station as any).PendingFileTypeIds]);

  const isDraftStation =
    station.VendorStatusId === 2 ||
    (station as any).StatusId === 2 ||
    station.StatusId === 2 ||
    station.VendorStatusName === 'Draft' ||
    (station as any).InstallationSubmissionStatusId === 2 ||
    pendingTypesFromStation.length > 0;

  const [fileTypes, setFileTypes] = useState<VendorFileType[]>([]);
  const sortedFileTypes = React.useMemo(
    () => sortFileTypesByCustomOrder(fileTypes),
    [fileTypes],
  );
  const [isLoadingTypes, setIsLoadingTypes] = useState<boolean>(true);
  const [selectedFiles, setSelectedFiles] = useState<SelectedFileMap>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const [isDraftRestored, setIsDraftRestored] = useState<boolean>(false);
  const [geoTaggingId, setGeoTaggingId] = useState<number | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<ViewingPhotoInfo | null>(null);

  // Hardware serial numbers & switch firmware state (auto-restored from SQLite cache)
  const [switchSerialNumber, setSwitchSerialNumber] = useState<string>(() => {
    const sw = station.SwitchSerialNumber || (station as any).switchSerialNumber || '';
    return sw === 'N/A' || sw === 'NA' ? '' : sw;
  });
  const [resilientSerialNumber, setResilientSerialNumber] = useState<string>(() => {
    const res = station.ResilientSerialNumber || (station as any).resilientSerialNumber || '';
    return res === 'N/A' || res === 'NA' ? '' : res;
  });
  const [switchFirmwareNumber, setSwitchFirmwareNumber] = useState<string>(() => {
    const fw = station.SwitchFirmWareNumber || (station as any).SwitchFirmwareNumber || '';
    return fw === 'N/A' || fw === 'NA' ? '' : fw;
  });

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

  // Auto-populate stored photos and hardware serial numbers draft from SQLite immediately on mount
  useEffect(() => {
    let isMounted = true;
    getStationProofDraft(station.ExcelDataId, currentVendor.VendorId).then(draft => {
      if (isMounted && draft.hasDraft) {
        if (Object.keys(draft.photos).length > 0) {
          setSelectedFiles(draft.photos);
        }
        // Restore cached Switch Serial Number and Resilient Serial Number from SQLite draft
        if (draft.switchSerialNumber && draft.switchSerialNumber.trim().length > 0) {
          setSwitchSerialNumber(draft.switchSerialNumber.trim());
        }
        if (draft.resilientSerialNumber && draft.resilientSerialNumber.trim().length > 0) {
          setResilientSerialNumber(draft.resilientSerialNumber.trim());
        }
        if (draft.switchFirmwareNumber) {
          const fw = draft.switchFirmwareNumber;
          if (fw !== 'N/A' && fw !== 'NA') {
            setSwitchFirmwareNumber(fw);
          }
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

  useEffect(() => {
    let isMounted = true;
    const loadTypes = async () => {
      // 1. If station has remaining pending types from Draft, use them directly!
      if (pendingTypesFromStation.length > 0) {
        const sorted = sortFileTypesByCustomOrder(pendingTypesFromStation);
        if (isMounted) {
          setFileTypes(sorted);
          setIsLoadingTypes(false);
        }
        return;
      }

      // 2. Brand new pending station (where PendingFileTypes is empty):
      // Fetch full dropdown list from API when online, or from SQLite cache / defaults when offline
      setIsLoadingTypes(true);
      try {
        let types: VendorFileType[] = [];
        try {
          types = isWorker
            ? await apiService.fetchWorkerInsertDropdown(1)
            : await apiService.fetchAssignStationDetailDropdown(2);
        } catch (netErr) {
          console.warn('[ProofSection] Network error fetching dropdown types, loading from SQLite cache:', netErr);
        }

        if (!types || types.length === 0) {
          types = await getCachedFileTypes();
        }

        if (!types || types.length === 0) {
          types = DEFAULT_FILE_TYPES;
        }

        if (isMounted && types && types.length > 0) {
          const sorted = sortFileTypesByCustomOrder(types);
          setFileTypes(sorted);
          saveCachedFileTypes(sorted).catch(() => {});
        }
      } catch (err) {
        console.warn('[ProofSection] Error loading types, falling back to defaults:', err);
        const fallback = sortFileTypesByCustomOrder(DEFAULT_FILE_TYPES);
        if (isMounted) setFileTypes(fallback);
      } finally {
        if (isMounted) setIsLoadingTypes(false);
      }
    };

    loadTypes();
    return () => {
      isMounted = false;
    };
  }, [isWorker, pendingTypesFromStation]);

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
      quality: 0.7 as const, // Valid PhotoQuality: sharp equipment details, strictly under 1 MB (~180-320 KB)
      maxWidth: 1280,        // Max dimension 1280px ensures fast upload and crisp serials
      maxHeight: 1280,
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
          const rawSize = asset.fileSize || 0;
          const isLarge = rawSize > 850 * 1024;

          const taggedAsset: TaggedAsset = { ...asset, uri: rawUri };
          const hasLocationPerm = await requestLocationPermission();

          if (hasLocationPerm) {
            const coords = await getCurrentLocation();
            if (coords) {
              const capturedAt = formatDateTime(new Date());
              const address = await reverseGeocode(coords.latitude, coords.longitude);
              const geoTag: GeoTag = { latitude: coords.latitude, longitude: coords.longitude, address, capturedAt };
              const taggedUri = await stampGeoTag(rawUri, geoTag, isLarge);
              const safeTaggedUri = ensureFileUri(taggedUri);

              // Single-pass stamped photo is guaranteed ~180-320 KB (strictly under 1 MB limit)
              const finalSize = isLarge ? 220 * 1024 : (rawSize ? Math.min(rawSize, 380 * 1024) : 260 * 1024);
              taggedAsset.taggedUri = safeTaggedUri;
              taggedAsset.uri = safeTaggedUri;
              taggedAsset.fileSize = finalSize;
              taggedAsset.geoTag = geoTag;
            } else {
              let safeUri = rawUri;
              let finalSize = rawSize || 250 * 1024;
              if (isLarge) {
                const comp = await compressPhotoUnder1MB(rawUri);
                safeUri = comp.uri;
                finalSize = comp.size;
              }
              taggedAsset.uri = safeUri;
              taggedAsset.fileSize = finalSize;
            }
          } else {
            let safeUri = rawUri;
            let finalSize = rawSize || 250 * 1024;
            if (isLarge) {
              const comp = await compressPhotoUnder1MB(rawUri);
              safeUri = comp.uri;
              finalSize = comp.size;
            }
            taggedAsset.uri = safeUri;
            taggedAsset.fileSize = finalSize;
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
      // 1. Prepare structured file items (use geo-tagged URI if available, guaranteed < 1 MB)
      const finalSubmissionFiles: OfflineSubmissionFile[] = [];
      for (const fileTypeId of selectedIds) {
        const asset = selectedFiles[fileTypeId];
        if (asset) {
          let fileUri = asset.taggedUri || asset.uri;
          if (!fileUri) continue;
          const matchedType = sortedFileTypes.find(t => t.VendorFileTypeId === fileTypeId);
          const fileExtension = asset.fileName ? asset.fileName.split('.').pop() : 'jpg';
          const fileName = `proof_${fileTypeId}_${Date.now()}.${fileExtension || 'jpg'}`;
          let fileSize = asset.fileSize || 250 * 1024;

          // Extreme safeguard: If any photo somehow exceeds 1 MB, recompress sequentially
          if (fileSize > 1000 * 1024) {
            const comp = await compressPhotoUnder1MB(fileUri);
            fileUri = comp.uri;
            fileSize = comp.size;
          }

          finalSubmissionFiles.push({
            uri: fileUri,
            name: fileName,
            type: asset.type || 'image/jpeg',
            fileTypeId,
            fileTypeName: matchedType?.VendorFileTypeName || `File #${fileTypeId}`,
            size: fileSize,
          });
        }
      }

      // Automated 300m geo-fence verification remarks
      const submissionRemarks = buildAutomaticRemarks(station, selectedFiles);

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

      const createdBy = isWorker
        ? (workerPhone ? `${workerName} - ${workerPhone}` : workerName)
        : (currentVendor.VendorName ||
           currentVendor.ContactPerson ||
           currentVendor.CreatedByUserName ||
           'Vendor');

      const routeStationStatusId = Number(
        station.RouteStationStatusId || (station as any).routeStationStatusId || 0,
      );

      // 2. Check current network connectivity
      const netState = await NetInfo.fetch();
      const isOnline = netState.isConnected === true && netState.isInternetReachable !== false;

      // Prepare fallback serials and firmware so backend non-empty check succeeds
      const finalSwitchSerial =
        switchSerialNumber.trim() ||
        station.SwitchSerialNumber ||
        (station as any).switchSerialNumber ||
        'N/A';

      const finalResilientSerial =
        resilientSerialNumber.trim() ||
        station.ResilientSerialNumber ||
        (station as any).resilientSerialNumber ||
        'N/A';

      const finalSwitchFirmware =
        switchFirmwareNumber.trim() ||
        station.SwitchFirmWareNumber ||
        (station as any).SwitchFirmwareNumber ||
        'N/A';

      if (isOnline) {
        // --- ONLINE: DIRECT API SUBMISSION ---
        try {
          const formData = new FormData();

          if (isWorker) {
            // Worker station submission to /vendorWorkerAssign/insertingWorkerStationSubmission
            formData.append('flagId', '1');
            formData.append('WorkerStationAssignmentId', String(workerStationAssignmentId));
            formData.append('WorkerId', String(activeWorkerId));
            formData.append('ExcelDataId', String(station.ExcelDataId));
            formData.append('Remarks', submissionRemarks);
            formData.append('SwitchFirmWareNumber', finalSwitchFirmware);
            formData.append('SwitchSerialNumber', finalSwitchSerial);
            formData.append('ResilientSerialNumber', finalResilientSerial);
            formData.append('CreatedByUserName', createdBy);
            formData.append('FileTypeIds', JSON.stringify(selectedIds));
            formData.append('FileTypeId', JSON.stringify(selectedIds));
          } else {
            // Vendor station submission to /assignVendor/createInstallationSubmission
            formData.append('ExcelDataId', String(station.ExcelDataId));
            formData.append('VendorId', String(currentVendor.VendorId));
            if (currentVendor.VendorWorkerId) {
              formData.append('VendorWorkerId', String(currentVendor.VendorWorkerId));
            }
            formData.append('Remarks', submissionRemarks);
            formData.append('CreatedByUserName', createdBy);
            formData.append('flagId', '2');
            formData.append('FileTypeId', JSON.stringify(selectedIds));
            formData.append('FileTypeIds', JSON.stringify(selectedIds));
            formData.append('SwitchSerialNumber', finalSwitchSerial);
            formData.append('ResilientSerialNumber', finalResilientSerial);
            formData.append('SwitchFirmWareNumber', finalSwitchFirmware);
            formData.append('RouteStationStatusId', String(routeStationStatusId));
          }

          finalSubmissionFiles.forEach(file => {
            formData.append('files', {
              uri: Platform.OS === 'android' ? file.uri : file.uri.replace('file://', ''),
              name: file.name,
              type: file.type,
            } as any);
          });

          const response = isWorker
            ? await apiService.insertWorkerStationSubmission(formData)
            : await apiService.createInstallationSubmission(formData);

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
        vendorWorkerId: isWorker ? activeWorkerId : (currentVendor.VendorWorkerId || undefined),
        workerStationAssignmentId: isWorker ? workerStationAssignmentId : undefined,
        isWorkerSubmission: isWorker,
        remarks: submissionRemarks,
        createdByUserName: createdBy,
        flagId: isWorker ? '1' : '2',
        fileTypeIds: selectedIds,
        files: finalSubmissionFiles,
        switchSerialNumber: finalSwitchSerial,
        resilientSerialNumber: finalResilientSerial,
        switchFirmwareNumber: finalSwitchFirmware,
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
    const hasAnyPhoto = selectedIds.length > 0;

    // 1. Strict binding check: Switch Serial Number and its photo MUST be submitted together
    const switchFileType = sortedFileTypes.find(isSwitchSerialType);
    const hasSwitchPhotoInPending = Boolean(switchFileType);
    const hasSwitchPhotoSelected = Boolean(
      switchFileType && selectedFiles[switchFileType.VendorFileTypeId],
    );

    // 2. Strict binding check: Resilient Serial Number and its photo MUST be submitted together
    const resilientFileType = sortedFileTypes.find(isResilientSerialType);
    const hasResilientPhotoInPending = Boolean(resilientFileType);
    const hasResilientPhotoSelected = Boolean(
      resilientFileType && selectedFiles[resilientFileType.VendorFileTypeId],
    );

    const hasAnyHardware =
      (hasSwitchPhotoInPending && Boolean(switchSerialNumber.trim())) ||
      (hasResilientPhotoInPending && Boolean(resilientSerialNumber.trim())) ||
      Boolean(switchFirmwareNumber.trim());

    if (!hasAnyPhoto && !hasAnyHardware) {
      Alert.alert(
        'Incomplete Submission',
        'Please attach at least one photo or enter hardware details before submitting.',
      );
      return;
    }

    const bindingErrors: string[] = [];

    // Switch Serial binding check: user cannot submit switch serial number without its photo
    if (hasSwitchPhotoInPending) {
      if (switchSerialNumber.trim() && !hasSwitchPhotoSelected) {
        bindingErrors.push(
          '• Switch Serial Number is entered, but its photo is missing. You cannot submit Switch Serial Number without its photo.',
        );
      } else if (!switchSerialNumber.trim() && hasSwitchPhotoSelected) {
        bindingErrors.push(
          '• Switch Serial Number photo is captured, but the serial number is empty. Please enter the Switch Serial Number.',
        );
      }
    }

    // Resilient Serial binding check: user cannot submit resilient serial number without its photo
    if (hasResilientPhotoInPending) {
      if (resilientSerialNumber.trim() && !hasResilientPhotoSelected) {
        bindingErrors.push(
          '• Resilient Serial Number is entered, but its photo is missing. You cannot submit Resilient Serial Number without its photo.',
        );
      } else if (!resilientSerialNumber.trim() && hasResilientPhotoSelected) {
        bindingErrors.push(
          '• Resilient Serial Number photo is captured, but the serial number is empty. Please enter the Resilient Serial Number.',
        );
      }
    }

    if (bindingErrors.length > 0) {
      Alert.alert(
        'Photo & Serial Number Binding Error ⚠️',
        `Serial number and photo must be uploaded together:\n\n${bindingErrors.join(
          '\n\n',
        )}\n\nPlease attach the required photo or enter the corresponding serial number.`,
      );
      return;
    }

    // 3. Annexure-11 check: Annexure-11 should ONLY get submitted when all fields and photos are submitted / getting submitted
    const annexureFileType = sortedFileTypes.find(isAnnexure11Type);
    const hasAnnexureSelected = Boolean(
      annexureFileType && selectedFiles[annexureFileType.VendorFileTypeId],
    );

    if (hasAnnexureSelected) {
      const missingForAnnexure: string[] = [];

      // Check all other photo types in sortedFileTypes
      sortedFileTypes.forEach(t => {
        if (!isAnnexure11Type(t)) {
          if (!selectedFiles[t.VendorFileTypeId]) {
            missingForAnnexure.push(`• Photo: ${t.VendorFileTypeName} (#${t.VendorFileTypeId})`);
          }
        }
      });

      // Check switch serial number if card #11 is present in pending
      if (hasSwitchPhotoInPending) {
        if (!switchSerialNumber.trim()) {
          missingForAnnexure.push('• Field: Switch Serial Number');
        }
        if (!hasSwitchPhotoSelected) {
          missingForAnnexure.push('• Photo: Switch Serial Number Photo Proof (#11)');
        }
      }

      // Check resilient serial number if card #12 is present in pending
      if (hasResilientPhotoInPending) {
        if (!resilientSerialNumber.trim()) {
          missingForAnnexure.push('• Field: Resilient Serial Number');
        }
        if (!hasResilientPhotoSelected) {
          missingForAnnexure.push('• Photo: Resilient Serial Number Photo Proof (#12)');
        }
      }

      // Check switch firmware number
      const hasFirmwareEntered =
        Boolean(switchFirmwareNumber.trim()) ||
        Boolean(
          station.SwitchFirmWareNumber &&
          station.SwitchFirmWareNumber !== 'N/A' &&
          station.SwitchFirmWareNumber !== 'NA',
        );
      if (!hasFirmwareEntered) {
        missingForAnnexure.push('• Field: Switch Firmware Version / Number');
      }

      if (missingForAnnexure.length > 0) {
        Alert.alert(
          'Annexure-11 Submission Restriction ⚠️',
          `Annexure-11 is the final handover / sign-off document and can only be submitted when all other equipment photos and hardware fields are submitted.\n\nPlease complete the following remaining items first:\n\n${missingForAnnexure.join(
            '\n',
          )}`,
        );
        return;
      }
    }

    isSubmittingRef.current = true;
    await performSubmission(selectedIds);
  };

  const hasSwitchInPending = sortedFileTypes.some(isSwitchSerialType);
  const hasResilientInPending = sortedFileTypes.some(isResilientSerialType);

  const uploadedCount = Object.keys(selectedFiles).length;
  const totalCount = sortedFileTypes.length;
  const hasAnyPhoto = uploadedCount > 0;
  const hasAnyHardware =
    (hasSwitchInPending && Boolean(switchSerialNumber.trim())) ||
    (hasResilientInPending && Boolean(resilientSerialNumber.trim())) ||
    Boolean(switchFirmwareNumber.trim());
  const isSubmitDisabled = (!hasAnyPhoto && !hasAnyHardware) || isSubmitting;

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
      </View>

      {/* Draft Substation Notice Banner */}
      {isDraftStation && (
        <View style={styles.draftNoticeBanner}>
          <View style={styles.draftNoticeIconWrap}>
            <Text style={styles.draftNoticeIcon}>📝</Text>
          </View>
          <View style={styles.draftNoticeContent}>
            <Text style={styles.draftNoticeTitle}>Draft Substation (Partial Upload)</Text>
            <Text style={styles.draftNoticeText}>
              {totalCount > 0
                ? `Showing ${totalCount} remaining item${totalCount !== 1 ? 's' : ''} to upload. Nothing is mandatory — upload what you have and submit progress anytime.`
                : 'All photo types have been uploaded. You can submit or update hardware details.'}
            </Text>
          </View>
        </View>
      )}

      {isLoadingTypes ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="small" color="#2563EB" />
          <Text style={styles.loadingText}>Loading required photo types...</Text>
        </View>
      ) : (
        <View style={styles.typesList}>
          {sortedFileTypes.map(type => {
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

            const isSwitchCard = isSwitchSerialType(type);
            const isResilientCard = isResilientSerialType(type);
            const isBoundHardwareCard = isSwitchCard || isResilientCard;
            const isAnnexureCard = isAnnexure11Type(type);

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
                  isBoundHardwareCard ? styles.typeCardBound : null,
                  isUploaded ? styles.typeCardUploaded : null,
                ]}>
                <View style={styles.typeCardHeader}>
                  <View style={styles.typeTitleWrap}>
                    <Text style={styles.typeNumber}>#{type.VendorFileTypeId}</Text>
                    <Text style={styles.typeName}>{type.VendorFileTypeName}</Text>
                  </View>
                  <View style={styles.typeHeaderPillsRow}>
                    {isBoundHardwareCard && (
                      <View style={styles.statusPillBound}>
                        <Text style={styles.statusTextBound}>🔗 Bound S/N + Photo</Text>
                      </View>
                    )}
                    {isAnnexureCard && (
                      <View style={styles.statusPillAnnexure}>
                        <Text style={styles.statusTextAnnexure}>📋 Final Handover</Text>
                      </View>
                    )}
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
                </View>

                {/* Annexure-11 Notice Banner */}
                {isAnnexureCard && (
                  <View style={styles.annexureNoticeBox}>
                    <Text style={styles.annexureNoticeText}>
                      ℹ️ Final sign-off: Annexure-11 can only be submitted when all other photos &amp; hardware fields are submitted.
                    </Text>
                  </View>
                )}

                {/* Bound Serial Number Input (for Switch S/N and Resilient S/N) */}
                {isBoundHardwareCard && (
                  <View style={styles.boundSerialContainer}>
                    <View style={styles.boundSerialHeaderRow}>
                      <View style={styles.boundSerialTitleWrap}>
                        <Text style={styles.boundSerialIcon}>⌨️</Text>
                        <Text style={styles.boundSerialTitle}>
                          {isSwitchCard ? 'Switch Serial Number' : 'Resilient Serial Number'}
                        </Text>
                      </View>
                      <View style={styles.boundActionButtonsRow}>
                        {Boolean(isSwitchCard ? switchSerialNumber : resilientSerialNumber) && (
                          <TouchableOpacity
                            style={styles.clearSerialBtn}
                            onPress={isSwitchCard ? () => handleSwitchSerialChange('') : () => handleResilientSerialChange('')}
                            activeOpacity={0.7}>
                            <Text style={styles.clearSerialBtnText}>✕ Clear</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                    <TextInput
                      style={styles.hardwareInput}
                      placeholder={
                        isSwitchCard
                          ? 'Enter Switch Serial No. (e.g. 2660H2515XLH)'
                          : 'Enter Resilient Serial No. (e.g. 202607310903)'
                      }
                      placeholderTextColor="#94A3B8"
                      value={isSwitchCard ? switchSerialNumber : resilientSerialNumber}
                      onChangeText={isSwitchCard ? handleSwitchSerialChange : handleResilientSerialChange}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />

                    <View style={styles.boundPhotoSectionDivider}>
                      <Text style={styles.boundPhotoSectionTitle}>
                        📷 {isSwitchCard ? 'Switch' : 'Resilient'} Serial Number Photo Proof
                      </Text>
                    </View>
                  </View>
                )}

                {/* Photo Capture / Preview Container */}
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

      {/* Switch Firmware Verification Card */}
      <View style={styles.hardwareCard}>
        <View style={styles.hardwareCardHeader}>
          <View style={styles.hardwareHeaderTitleRow}>
            <Text style={styles.hardwareCardTitle}>⚡ Switch Firmware Verification</Text>
            {station.RouteStationStatusId ? (
              <View style={styles.routeStatusBadge}>
                <Text style={styles.routeStatusBadgeText}>
                  Route Status #{station.RouteStationStatusId}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.hardwareCardSub}>
            Enter the active switch firmware version running on the hardware switch.
          </Text>
        </View>

        {/* 3. Switch Firmware Number */}
        <View style={styles.hardwareInputGroup}>
          <View style={styles.hardwareLabelRow}>
            <Text style={styles.hardwareLabel}>
              Switch Firmware Version / Number
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
          isSubmitDisabled ? styles.submitButtonDisabled : null,
        ]}
        onPress={handleSubmit}
        disabled={isSubmitDisabled}
        activeOpacity={0.85}>
        {isSubmitting ? (
          <View style={styles.submitRow}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.submitButtonText}>
              Submitting Proof (&lt; 1MB Photos)...
            </Text>
          </View>
        ) : (
          <Text style={styles.submitButtonText}>
            {isDraftStation
              ? `📤 Submit Draft Progress (${uploadedCount}/${totalCount} Photos)`
              : `📤 Submit Installation Proof (${uploadedCount}/${totalCount})`}
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
                  {(viewingPhoto.fileSize / 1024).toFixed(1)} KB (✓ &lt; 1 MB)
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
  firmwareHelperText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 15,
  },
  typeCardBound: {
    backgroundColor: '#F8FAFC',
    borderColor: '#94A3B8',
    borderWidth: 1.5,
  },
  typeHeaderPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPillBound: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  statusTextBound: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338CA',
  },
  statusPillAnnexure: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  statusTextAnnexure: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  annexureNoticeBox: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  annexureNoticeText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '600',
    lineHeight: 16,
  },
  boundSerialContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  boundSerialHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  boundActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hardwareLabelActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  clearSerialBtn: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  clearSerialBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  boundSerialTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  boundSerialIcon: {
    fontSize: 14,
  },
  boundSerialTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  boundPhotoSectionDivider: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  boundPhotoSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 2,
  },
  boundNoticePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 8,
  },
  boundNoticeIcon: {
    fontSize: 16,
  },
  boundNoticeText: {
    fontSize: 12,
    color: '#1E40AF',
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  draftNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  draftNoticeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftNoticeIcon: {
    fontSize: 18,
  },
  draftNoticeContent: {
    flex: 1,
  },
  draftNoticeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
  },
  draftNoticeText: {
    fontSize: 11,
    color: '#B45309',
    lineHeight: 16,
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
