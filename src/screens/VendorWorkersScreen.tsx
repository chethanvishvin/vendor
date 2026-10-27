import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Linking,
  ScrollView,
  PermissionsAndroid,
  RefreshControl,
} from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  Asset,
} from 'react-native-image-picker';
import {
  VendorProfile,
  VendorWorkerItem,
  WorkerDropdownItem,
  SubstationDropdownItem,
  VendorWorkerStationAssignmentItem,
} from '../types';
import { apiService } from '../api/apiService';

interface VendorWorkersScreenProps {
  currentVendor: VendorProfile;
  initialTab?: 'list' | 'assign' | 'assigned' | 'create';
  onBack: () => void;
}

interface WorkerDocFile {
  uri: string;
  fileName: string;
  type: string;
  fileSize?: number;
}

export const VendorWorkersScreen: React.FC<VendorWorkersScreenProps> = ({
  currentVendor,
  initialTab = 'list',
  onBack,
}) => {
  const [activeTab, setActiveTab] = useState<'list' | 'assign' | 'assigned' | 'create'>(initialTab);
  const [workers, setWorkers] = useState<VendorWorkerItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Substation Assignment State (Online APIs)
  const [dropdownWorkers, setDropdownWorkers] = useState<WorkerDropdownItem[]>([]);
  const [dropdownSubstations, setDropdownSubstations] = useState<SubstationDropdownItem[]>([]);
  const [isLoadingAssignData, setIsLoadingAssignData] = useState<boolean>(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  const [selectedExcelDataIds, setSelectedExcelDataIds] = useState<number[]>([]);
  const [isSubmittingAssign, setIsSubmittingAssign] = useState<boolean>(false);
  const [substationSearchQuery, setSubstationSearchQuery] = useState<string>('');
  const [workerPickerVisible, setWorkerPickerVisible] = useState<boolean>(false);
  const [workerSearchQuery, setWorkerSearchQuery] = useState<string>('');

  // Assigned Details State (Which station to which worker from fetchVendorAssignWorkerDetails)
  const [assignedDetails, setAssignedDetails] = useState<VendorWorkerStationAssignmentItem[]>([]);
  const [isLoadingAssignedDetails, setIsLoadingAssignedDetails] = useState<boolean>(false);
  const [assignedSearchQuery, setAssignedSearchQuery] = useState<string>('');
  const [assignedStatusFilter, setAssignedStatusFilter] = useState<'ALL' | '1' | '3'>('ALL');
  const [selectedWorkerFilterId, setSelectedWorkerFilterId] = useState<number | null>(null);

  // Create Worker Form State
  const [userName, setUserName] = useState<string>('');
  const [mobileNumber, setMobileNumber] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState<boolean>(false);

  // Document Files (1=Aadhar, 2=PAN, 3=Worker Photo)
  const [aadharDoc, setAadharDoc] = useState<WorkerDocFile | null>(null);
  const [panDoc, setPanDoc] = useState<WorkerDocFile | null>(null);
  const [workerPhoto, setWorkerPhoto] = useState<WorkerDocFile | null>(null);

  // Change Password Modal State
  const [passwordModalVisible, setPasswordModalVisible] = useState<boolean>(false);
  const [targetWorker, setTargetWorker] = useState<VendorWorkerItem | null>(null);
  const [manualWorkerId, setManualWorkerId] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showNewPassword, setShowNewPassword] = useState<boolean>(false);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState<boolean>(false);

  // Edit Worker Modal State
  const [editModalVisible, setEditModalVisible] = useState<boolean>(false);
  const [editingWorker, setEditingWorker] = useState<VendorWorkerItem | null>(null);
  const [editUserName, setEditUserName] = useState<string>('');
  const [editMobileNumber, setEditMobileNumber] = useState<string>('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState<boolean>(false);

  const loadWorkers = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoadingList(true);
    }
    setFetchError(null);

    // Fetch fresh worker details directly from backend API (online only)
    try {
      const response = await apiService.fetchVendorWorkers(currentVendor.VendorId, 2);
      if (response && response.status && Array.isArray(response.data)) {
        setWorkers(response.data);
      } else {
        setWorkers([]);
        setFetchError(response?.message || 'Failed to fetch workers from server.');
      }
    } catch (err: any) {
      setWorkers([]);
      setFetchError(
        err.message ||
          'Unable to connect to server. Worker directory requires an active internet connection.',
      );
    } finally {
      setIsLoadingList(false);
      setIsRefreshing(false);
    }
  }, [currentVendor.VendorId]);

  const loadAssignData = useCallback(async () => {
    setIsLoadingAssignData(true);
    setAssignError(null);
    try {
      const [workersList, substationsList] = await Promise.all([
        apiService.fetchWorkerDropdown(currentVendor.VendorId),
        apiService.fetchSubstationDropdown(currentVendor.VendorId),
      ]);
      setDropdownWorkers(workersList || []);
      setDropdownSubstations(substationsList || []);
    } catch (err: any) {
      setAssignError(err.message || 'Failed to load worker assignment dropdowns.');
    } finally {
      setIsLoadingAssignData(false);
    }
  }, [currentVendor.VendorId]);

  const loadAssignedDetails = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoadingAssignedDetails(true);
    }
    try {
      const list = await apiService.fetchVendorAssignWorkerDetails(currentVendor.VendorId, 1);
      setAssignedDetails(list || []);
    } catch (err: any) {
      console.warn('Failed to load vendor-worker assigned details:', err.message);
    } finally {
      setIsLoadingAssignedDetails(false);
      setIsRefreshing(false);
    }
  }, [currentVendor.VendorId]);

  useEffect(() => {
    loadWorkers();
    loadAssignedDetails();
    if (initialTab === 'assign') {
      loadAssignData();
    }
  }, [loadWorkers, loadAssignedDetails, loadAssignData, initialTab]);

  const handleToggleSubstation = (excelDataId: number) => {
    setSelectedExcelDataIds(prev =>
      prev.includes(excelDataId)
        ? prev.filter(id => id !== excelDataId)
        : [...prev, excelDataId],
    );
  };

  const handleSelectAllSubstations = () => {
    const allFilteredIds = filteredSubstations.map(s => s.ExcelDataId);
    setSelectedExcelDataIds(allFilteredIds);
  };

  const handleClearAllSubstations = () => {
    setSelectedExcelDataIds([]);
  };

  const handleAssignForWorker = (worker: VendorWorkerItem) => {
    setSelectedWorkerId(worker.VendorWorkerUserId);
    setActiveTab('assign');
    loadAssignData();
  };

  const handleSubmitAssignment = async () => {
    if (!selectedWorkerId) {
      Alert.alert('Worker Required', 'Please select a worker to assign substations to.');
      return;
    }
    if (selectedExcelDataIds.length === 0) {
      Alert.alert('Substations Required', 'Please select at least one substation to assign.');
      return;
    }

    const selectedStations = dropdownSubstations.filter(s =>
      selectedExcelDataIds.includes(s.ExcelDataId),
    );

    if (selectedStations.length === 0) {
      Alert.alert('Selection Error', 'No valid substations found for assignment.');
      return;
    }

    // Concatenate vendor contact/person name and phone number as instructed
    const vendorName =
      currentVendor.VendorName ||
      currentVendor.UserName ||
      currentVendor.ContactPerson ||
      currentVendor.CompanyName ||
      'Vendor Admin';
    const vendorPhone = currentVendor.ContactNumber || currentVendor.MobileNumber || '';
    const createdByUserName = vendorPhone ? `${vendorName} - ${vendorPhone}` : vendorName;

    setIsSubmittingAssign(true);
    try {
      // Group by VendorAssignmentId so each batch has the correct VendorAssignmentId
      const groups = new Map<number, number[]>();
      selectedStations.forEach(st => {
        const vId = st.VendorAssignmentId || 0;
        if (!groups.has(vId)) groups.set(vId, []);
        groups.get(vId)!.push(st.ExcelDataId);
      });

      for (const [vendorAssignmentId, excelIds] of groups.entries()) {
        await apiService.insertWorkerAssignment({
          flagId: 1,
          VendorId: currentVendor.VendorId,
          VendorAssignmentId: vendorAssignmentId,
          WorkerId: selectedWorkerId,
          ExcelDataIds: excelIds,
          CreatedByUserName: createdByUserName,
        });
      }

      const assignedWorker = dropdownWorkers.find(w => w.WorkerId === selectedWorkerId);
      const workerLabel = assignedWorker ? assignedWorker.WorkerName : `Worker #${selectedWorkerId}`;

      Alert.alert(
        'Substations Assigned Successfully! 🎉',
        `${selectedExcelDataIds.length} substation(s) have been assigned to ${workerLabel}.\n\nCreated By: ${createdByUserName}`,
        [
          {
            text: 'View Assigned',
            onPress: () => {
              setActiveTab('assigned');
            },
          },
          { text: 'Done', style: 'default' },
        ],
      );

      // Reset selection and refresh dropdown data and assigned details
      setSelectedExcelDataIds([]);
      await Promise.all([
        loadAssignData(),
        loadAssignedDetails(true),
      ]);
    } catch (err: any) {
      Alert.alert('Assignment Failed', err.message || 'Server rejected substation assignment.');
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  const requestCameraPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission Needed',
          message: 'Camera permission is required to capture worker identity documents.',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch {
      return false;
    }
  };

  const handlePickDocument = (
    docType: 1 | 2 | 3,
    source: 'camera' | 'gallery',
  ) => {
    const options = {
      mediaType: 'photo' as const,
      quality: 0.8 as const,
      maxWidth: 1920,
      maxHeight: 1920,
      saveToPhotos: false,
    };

    const applyAsset = (asset: Asset) => {
      if (!asset.uri) return;
      const fileData: WorkerDocFile = {
        uri: asset.uri,
        fileName: asset.fileName || `doc_${docType}_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
        fileSize: asset.fileSize,
      };

      if (docType === 1) setAadharDoc(fileData);
      else if (docType === 2) setPanDoc(fileData);
      else if (docType === 3) setWorkerPhoto(fileData);
    };

    if (source === 'camera') {
      requestCameraPermission().then(granted => {
        if (!granted) {
          Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
          return;
        }
        launchCamera(options, response => {
          if (response.assets && response.assets.length > 0) {
            applyAsset(response.assets[0]);
          }
        });
      });
    } else {
      launchImageLibrary(options, response => {
        if (response.assets && response.assets.length > 0) {
          applyAsset(response.assets[0]);
        }
      });
    }
  };

  const handleMobileNumberChange = (text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, 10);
    setMobileNumber(digitsOnly);
  };

  const handleEditMobileChange = (text: string) => {
    const digitsOnly = text.replace(/[^0-9]/g, '').slice(0, 10);
    setEditMobileNumber(digitsOnly);
  };

  // Submit Create Worker
  const handleCreateWorker = async () => {
    if (!userName.trim()) {
      Alert.alert('Validation Error', 'Please enter worker full name or username.');
      return;
    }
    const cleanPhone = mobileNumber.replace(/[^0-9]/g, '');
    if (cleanPhone.length !== 10) {
      Alert.alert('Validation Error', 'Worker mobile number must be exactly 10 digits.');
      return;
    }
    if (!password.trim()) {
      Alert.alert('Validation Error', 'Please enter an initial access password.');
      return;
    }
    if (!aadharDoc) {
      Alert.alert('Document Missing', 'Please upload Document #1: Aadhar Card.');
      return;
    }
    if (!panDoc) {
      Alert.alert('Document Missing', 'Please upload Document #2: PAN Card.');
      return;
    }
    if (!workerPhoto) {
      Alert.alert('Document Missing', 'Please upload Document #3: Worker Photograph.');
      return;
    }

    setIsSubmittingCreate(true);
    try {
      const formData = new FormData();
      formData.append('VendorId', String(currentVendor.VendorId));
      formData.append('UserName', userName.trim());
      formData.append('Password', password.trim());
      formData.append('MobileNumber', cleanPhone);
      formData.append('RoleId', '9');
      formData.append('flagId', '1');
      formData.append('FileTypeIds', JSON.stringify([1, 2, 3]));

      // 1 = Aadhar Card
      formData.append('files', {
        uri: Platform.OS === 'android' ? aadharDoc.uri : aadharDoc.uri.replace('file://', ''),
        name: aadharDoc.fileName,
        type: aadharDoc.type,
      } as any);

      // 2 = PAN Card
      formData.append('files', {
        uri: Platform.OS === 'android' ? panDoc.uri : panDoc.uri.replace('file://', ''),
        name: panDoc.fileName,
        type: panDoc.type,
      } as any);

      // 3 = Worker Photograph
      formData.append('files', {
        uri: Platform.OS === 'android' ? workerPhoto.uri : workerPhoto.uri.replace('file://', ''),
        name: workerPhoto.fileName,
        type: workerPhoto.type,
      } as any);

      formData.append('IncomingRoleId', String(currentVendor.RoleId || 8));

      const response = await apiService.createVendorWorker(formData);

      if (response && response.status) {
        const newWorkerUserId = response.data?.VendorWorkerUserId;

        // Reset form
        setUserName('');
        setMobileNumber('');
        setPassword('');
        setAadharDoc(null);
        setPanDoc(null);
        setWorkerPhoto(null);

        await loadWorkers();
        setActiveTab('list');

        Alert.alert(
          'Worker Created Successfully! 🎉',
          `Vendor Worker "${userName.trim()}"${newWorkerUserId ? ` (Worker User ID: #${newWorkerUserId})` : ''} has been created.\n\nThe worker can now log into the Vendor App using Mobile Number: ${cleanPhone}.`,
        );
      } else {
        Alert.alert('Registration Failed', response.message || 'Server rejected worker creation.');
      }
    } catch (err: any) {
      Alert.alert('Registration Error', err.message || 'Network error occurred while creating worker.');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Open Edit Modal for a worker
  const handleOpenEditModal = (worker: VendorWorkerItem) => {
    setEditingWorker(worker);
    setEditUserName(worker.UserName || '');
    setEditMobileNumber(worker.MobileNumber || '');
    setEditModalVisible(true);
  };

  // Submit Edit Worker
  const handleSaveEditWorker = async () => {
    if (!editingWorker) return;
    if (!editUserName.trim()) {
      Alert.alert('Validation Error', 'Worker name cannot be empty.');
      return;
    }
    const cleanPhone = editMobileNumber.replace(/[^0-9]/g, '');
    if (cleanPhone.length !== 10) {
      Alert.alert('Validation Error', 'Worker mobile number must be exactly 10 digits.');
      return;
    }

    setIsSubmittingEdit(true);
    try {
      const response = await apiService.editVendorWorker({
        flagId: 1,
        VendorWorkerUserId: editingWorker.VendorWorkerUserId,
        VendorId: currentVendor.VendorId,
        UserName: editUserName.trim(),
        MobileNumber: cleanPhone,
      });

      if (response && response.status) {
        // Update local list state
        setWorkers(prev =>
          prev.map(w =>
            w.VendorWorkerUserId === editingWorker.VendorWorkerUserId
              ? { ...w, UserName: editUserName.trim(), MobileNumber: cleanPhone }
              : w,
          ),
        );

        setEditModalVisible(false);
        Alert.alert(
          'Worker Updated! ✅',
          `Details for "${editUserName.trim()}" (ID: #${editingWorker.VendorWorkerUserId}) have been updated successfully.`,
        );
      } else {
        Alert.alert('Update Failed', response.message || 'Server could not update worker details.');
      }
    } catch (err: any) {
      Alert.alert('Update Error', err.message || 'Unable to update worker details.');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Open Password Modal for a specific worker
  const handleOpenPasswordModal = (worker?: VendorWorkerItem) => {
    setTargetWorker(worker || null);
    setManualWorkerId(worker ? String(worker.VendorWorkerUserId) : '');
    setNewPassword('');
    setConfirmPassword('');
    setShowNewPassword(false);
    setPasswordModalVisible(true);
  };

  // Submit Password Change
  const handleChangePassword = async () => {
    const workerUserId = targetWorker?.VendorWorkerUserId || Number(manualWorkerId);
    if (!workerUserId || isNaN(workerUserId)) {
      Alert.alert('Validation Error', 'Please enter a valid Worker User ID.');
      return;
    }
    if (!newPassword.trim()) {
      Alert.alert('Validation Error', 'Please enter the new password.');
      return;
    }
    if (newPassword.trim().length < 6) {
      Alert.alert('Validation Error', 'Password should be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Validation Error', 'New password and confirm password do not match.');
      return;
    }

    setIsSubmittingPassword(true);
    try {
      const response = await apiService.changeVendorWorkerPassword({
        VendorWorkerUserId: workerUserId,
        NewPassword: newPassword.trim(),
        IncomingVendorId: currentVendor.VendorId,
        IncomingRoleId: currentVendor.RoleId || 8,
      });

      if (response && response.status) {
        setPasswordModalVisible(false);
        const displayName = response.data?.UserName || targetWorker?.UserName || `Worker #${workerUserId}`;
        Alert.alert(
          'Password Changed! 🔑',
          `Password for ${displayName} has been updated successfully. The worker can now log in with the new password.`,
        );
      } else {
        Alert.alert('Password Update Failed', response.message || 'Server could not update password.');
      }
    } catch (err: any) {
      Alert.alert('Password Update Error', err.message || 'Unable to update worker password.');
    } finally {
      setIsSubmittingPassword(false);
    }
  };

  const filteredWorkers = workers.filter(w => {
    const q = searchQuery.toLowerCase();
    return (
      (w.UserName || '').toLowerCase().includes(q) ||
      (w.MobileNumber || '').includes(q) ||
      String(w.VendorWorkerUserId).includes(q)
    );
  });

  const filteredSubstations = dropdownSubstations.filter(s => {
    if (!substationSearchQuery.trim()) return true;
    const q = substationSearchQuery.toLowerCase();
    const nameMatch = (s.StationName || '').toLowerCase().includes(q);
    const idMatch = String(s.ExcelDataId).includes(q);
    const assignIdMatch = String(s.VendorAssignmentId).includes(q);
    return nameMatch || idMatch || assignIdMatch;
  });

  const filteredDropdownWorkers = dropdownWorkers.filter(w => {
    if (!workerSearchQuery.trim()) return true;
    const q = workerSearchQuery.toLowerCase();
    const nameMatch = (w.WorkerName || '').toLowerCase().includes(q);
    const idMatch = String(w.WorkerId).includes(q);
    return nameMatch || idMatch;
  });

  const selectedWorkerObj = dropdownWorkers.find(w => w.WorkerId === selectedWorkerId);

  const filteredAssignedDetails = assignedDetails.filter(item => {
    if (selectedWorkerFilterId !== null && item.WorkerId !== selectedWorkerFilterId) {
      return false;
    }
    if (assignedStatusFilter === '1' && item.StatusId !== 1) {
      return false;
    }
    if (assignedStatusFilter === '3' && item.StatusId !== 3) {
      return false;
    }
    if (assignedSearchQuery.trim()) {
      const q = assignedSearchQuery.toLowerCase();
      const stationMatch = (item.StationName || '').toLowerCase().includes(q);
      const workerMatch = (item.WorkerName || '').toLowerCase().includes(q);
      const phoneMatch = (item.WorkerMobileNumber || '').includes(q);
      const talukMatch = (item.Taluk || '').toLowerCase().includes(q);
      const divisionMatch = (item.Division || '').toLowerCase().includes(q);
      const circleMatch = (item.Circle || '').toLowerCase().includes(q);
      const aejeMatch = (item.InChangreAEJEname || '').toLowerCase().includes(q);
      const voltageMatch = (item.VoltageClass || '').includes(q);
      const excelIdMatch = String(item.ExcelDataId || '').includes(q);
      const workerIdMatch = String(item.WorkerId || '').includes(q);
      return (
        stationMatch ||
        workerMatch ||
        phoneMatch ||
        talukMatch ||
        divisionMatch ||
        circleMatch ||
        aejeMatch ||
        voltageMatch ||
        excelIdMatch ||
        workerIdMatch
      );
    }
    return true;
  });

  const pendingAssignedCount = assignedDetails.filter(a => a.StatusId === 1).length;
  const completedAssignedCount = assignedDetails.filter(a => a.StatusId === 3).length;

  const vendorName =
    currentVendor.VendorName ||
    currentVendor.UserName ||
    currentVendor.ContactPerson ||
    currentVendor.CompanyName ||
    'Vendor Admin';
  const vendorPhone = currentVendor.ContactNumber || currentVendor.MobileNumber || '';
  const createdByUserName = vendorPhone ? `${vendorName} - ${vendorPhone}` : vendorName;

  const renderDocUploadCard = (
    docType: 1 | 2 | 3,
    title: string,
    description: string,
    docFile: WorkerDocFile | null,
    onRemove: () => void,
  ) => {
    return (
      <View style={styles.docCard}>
        <View style={styles.docCardHeader}>
          <View style={styles.docTypeBadge}>
            <Text style={styles.docTypeBadgeText}>DOC #{docType}</Text>
          </View>
          <Text style={styles.docTitle}>{title}</Text>
        </View>
        <Text style={styles.docDesc}>{description}</Text>

        {docFile ? (
          <View style={styles.previewContainer}>
            <Image source={{ uri: docFile.uri }} style={styles.previewImage} />
            <View style={styles.previewInfo}>
              <Text style={styles.previewStatus}>✅ Document Attached</Text>
              <Text style={styles.previewFileName} numberOfLines={1}>
                {docFile.fileName}
              </Text>
              {docFile.fileSize ? (
                <Text style={styles.previewFileSize}>
                  {(docFile.fileSize / (1024 * 1024)).toFixed(2)} MB
                </Text>
              ) : null}
              <View style={styles.previewActions}>
                <TouchableOpacity
                  style={styles.retakeBtn}
                  onPress={() => handlePickDocument(docType, 'camera')}
                  activeOpacity={0.7}>
                  <Text style={styles.retakeBtnText}>📷 Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.changeGalleryBtn}
                  onPress={() => handlePickDocument(docType, 'gallery')}
                  activeOpacity={0.7}>
                  <Text style={styles.changeGalleryBtnText}>🖼️ Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.removeBtn}
                  onPress={onRemove}
                  activeOpacity={0.7}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.pickerActionsRow}>
            <TouchableOpacity
              style={styles.pickButtonCamera}
              onPress={() => handlePickDocument(docType, 'camera')}
              activeOpacity={0.8}>
              <Text style={styles.pickButtonCameraText}>📷 Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pickButtonGallery}
              onPress={() => handlePickDocument(docType, 'gallery')}
              activeOpacity={0.8}>
              <Text style={styles.pickButtonGalleryText}>🖼️ Pick from Gallery</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderWorkerCard = ({ item }: { item: VendorWorkerItem }) => {
    const formattedDate =
      item.VendorCreatedAt ||
      item.AdminCreatedAt ||
      (item.createdAt ? new Date(item.createdAt).toLocaleDateString() : null);

    return (
      <View style={styles.workerCard}>
        <View style={styles.workerCardTop}>
          <View style={styles.workerAvatar}>
            {item.photoUri ? (
              <Image source={{ uri: item.photoUri }} style={styles.workerAvatarImg} />
            ) : (
              <Text style={styles.workerAvatarText}>
                {(item.UserName || 'WK').substring(0, 2).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={styles.workerMetaWrap}>
            <View style={styles.workerNameRow}>
              <Text style={styles.workerName} numberOfLines={1}>
                {item.UserName}
              </Text>
              <View
                style={[
                  styles.workerRoleBadge,
                  item.IsDisabled ? styles.workerRoleDisabled : styles.workerRoleActive,
                ]}>
                <Text
                  style={[
                    styles.workerRoleText,
                    item.IsDisabled ? styles.workerTextDisabled : styles.workerTextActive,
                  ]}>
                  {item.IsDisabled ? 'INACTIVE' : `ROLE ${item.RoleId || 9}`}
                </Text>
              </View>
            </View>
            <Text style={styles.workerIdText}>
              Worker User ID: <Text style={styles.boldText}>#{item.VendorWorkerUserId}</Text>
            </Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${item.MobileNumber}`).catch(() => {})}
              activeOpacity={0.7}>
              <Text style={styles.workerPhone}>📞 +91 {item.MobileNumber}</Text>
            </TouchableOpacity>
            {formattedDate ? (
              <Text style={styles.workerDate}>
                Registered: {formattedDate.includes('T') ? new Date(formattedDate).toLocaleDateString() : formattedDate}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Worker Substation Assignment Count Badge */}
        {(() => {
          const workerAssignmentsCount = assignedDetails.filter(
            a => a.WorkerId === item.VendorWorkerUserId || a.WorkerMobileNumber === item.MobileNumber,
          ).length;
          return (
            <TouchableOpacity
              style={styles.workerAssignedBadge}
              onPress={() => {
                setSelectedWorkerFilterId(item.VendorWorkerUserId);
                setActiveTab('assigned');
              }}
              activeOpacity={0.8}>
              <Text style={styles.workerAssignedBadgeText}>
                📋 {workerAssignmentsCount} Substation{workerAssignmentsCount === 1 ? '' : 's'} Assigned ➔
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* Worker Actions Row: Assign Substations + Edit Details + Change Password */}
        <View style={styles.workerCardActions}>
          <TouchableOpacity
            style={styles.assignCardBtn}
            onPress={() => handleAssignForWorker(item)}
            activeOpacity={0.8}>
            <Text style={styles.assignCardBtnText}>⚡ Assign</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.editCardBtn}
            onPress={() => handleOpenEditModal(item)}
            activeOpacity={0.8}>
            <Text style={styles.editCardBtnText}>✏️ Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.changePasswordCardBtn}
            onPress={() => handleOpenPasswordModal(item)}
            activeOpacity={0.8}>
            <Text style={styles.changePasswordCardBtnText}>🔑 Password</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderAssignedStationCard = ({ item }: { item: VendorWorkerStationAssignmentItem }) => {
    const isCompleted = item.StatusId === 3;
    const isPending = item.StatusId === 1;

    const formattedDate = item.CreatedAt
      ? new Date(item.CreatedAt).toLocaleDateString(undefined, {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : null;

    const hasCoords = Boolean(item.Latitude && item.Longitude);

    const handleOpenMap = () => {
      if (!hasCoords) {
        Alert.alert('Location Unavailable', 'No GPS coordinates available for this substation.');
        return;
      }
      const query = encodeURIComponent(`${item.Latitude},${item.Longitude}`);
      const label = encodeURIComponent(item.StationName);
      const url =
        Platform.select({
          ios: `maps:0,0?q=${label}@${item.Latitude},${item.Longitude}`,
          android: `geo:0,0?q=${item.Latitude},${item.Longitude}(${label})`,
        }) || `https://www.google.com/maps/search/?api=1&query=${query}`;

      Linking.openURL(url).catch(() => {
        Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`);
      });
    };

    return (
      <View style={styles.assignedCard}>
        {/* Card Header: Station Name & Badges */}
        <View style={styles.assignedCardHeader}>
          <View style={styles.stationIconBox}>
            <Text style={styles.stationIconText}>⚡</Text>
          </View>
          <View style={styles.stationNameWrap}>
            <Text style={styles.assignedStationName} numberOfLines={1}>
              {item.StationName}
            </Text>
            <View style={styles.stationBadgesRow}>
              {item.VoltageClass ? (
                <View style={styles.voltageBadge}>
                  <Text style={styles.voltageBadgeText}>{item.VoltageClass} kV</Text>
                </View>
              ) : null}
              <View
                style={[
                  styles.statusBadge,
                  isCompleted
                    ? styles.statusBadgeCompleted
                    : isPending
                      ? styles.statusBadgePending
                      : styles.statusBadgeOther,
                ]}>
                <Text
                  style={[
                    styles.statusBadgeText,
                    isCompleted
                      ? styles.statusTextCompleted
                      : isPending
                        ? styles.statusTextPending
                        : styles.statusTextOther,
                  ]}>
                  {isCompleted
                    ? '✓ Completed'
                    : isPending
                      ? '⏳ Pending Installation'
                      : `Status #${item.StatusId}`}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Highlighted Field Worker Assignment Details */}
        <View style={styles.assignedWorkerBox}>
          <View style={styles.assignedWorkerHeaderRow}>
            <View style={styles.assignedWorkerIconBadge}>
              <Text style={styles.assignedWorkerIconEmoji}>👷</Text>
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.assignedWorkerHeaderLabel}>ASSIGNED FIELD WORKER</Text>
              <Text style={styles.assignedWorkerName} numberOfLines={1}>
                {item.WorkerName}
              </Text>
            </View>
            {item.WorkerMobileNumber ? (
              <TouchableOpacity
                style={styles.workerCallPill}
                onPress={() => Linking.openURL(`tel:${item.WorkerMobileNumber}`).catch(() => {})}
                activeOpacity={0.75}>
                <Text style={styles.workerCallPillText}>📞 Call Worker</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.assignedWorkerDetailsGrid}>
            <View style={styles.assignedWorkerCol}>
              <Text style={styles.assignedWorkerMetaLabel}>Mobile Number</Text>
              <Text style={styles.assignedWorkerMetaVal}>
                {item.WorkerMobileNumber ? `+91 ${item.WorkerMobileNumber}` : 'N/A'}
              </Text>
            </View>
            <View style={styles.assignedWorkerCol}>
              <Text style={styles.assignedWorkerMetaLabel}>Worker ID</Text>
              <Text style={styles.assignedWorkerMetaVal}>#{item.WorkerId}</Text>
            </View>
          </View>
        </View>

        {/* Location & Jurisdiction */}
        <View style={styles.assignedLocationSection}>
          <View style={styles.locationDetailRow}>
            <Text style={styles.locationIcon}>📍</Text>
            <Text style={styles.locationText} numberOfLines={2}>
              {[item.Taluk, item.Circle, item.Division, item.Zone].filter(Boolean).join(' • ')}
            </Text>
          </View>
          {item.SubStationAddress ? (
            <Text style={styles.addressText} numberOfLines={2}>
              {item.SubStationAddress}
              {item.PinCode ? ` - ${item.PinCode}` : ''}
            </Text>
          ) : null}
        </View>

        {/* In-Charge AE/JE Contact Info */}
        {(item.InChangreAEJEname || item.StationContactNumber) && (
          <View style={styles.aejeSection}>
            <View style={{ flex: 1 }}>
              <Text style={styles.aejeLabel}>IN-CHARGE AE / JE</Text>
              <Text style={styles.aejeName} numberOfLines={1}>
                {item.InChangreAEJEname || 'N/A'}
              </Text>
            </View>
            {item.StationContactNumber ? (
              <TouchableOpacity
                style={styles.aejeCallBtn}
                onPress={() => Linking.openURL(`tel:${item.StationContactNumber}`).catch(() => {})}
                activeOpacity={0.75}>
                <Text style={styles.aejeCallBtnText}>📞 {item.StationContactNumber}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Assignment Metadata Footer */}
        <View style={styles.assignedCardFooter}>
          <View style={styles.footerMetaCol}>
            <Text style={styles.footerMetaLabel}>Assignment Details</Text>
            <Text style={styles.footerMetaVal}>
              Excel ID: #{item.ExcelDataId} • Assignment #{item.VendorAssignmentId}
            </Text>
            {formattedDate && (
              <Text style={styles.footerMetaVal}>Assigned: {formattedDate}</Text>
            )}
            {item.CreatedByUserName && (
              <Text style={styles.footerMetaVal}>By: {item.CreatedByUserName}</Text>
            )}
          </View>

          {hasCoords && (
            <TouchableOpacity
              style={styles.mapBtn}
              onPress={handleOpenMap}
              activeOpacity={0.75}>
              <Text style={styles.mapBtnText}>🗺️ Map</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const attachedCount = [aadharDoc, panDoc, workerPhoto].filter(Boolean).length;

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.topHeader}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.topTitleWrap}>
          <Text style={styles.topTitle}>Vendor Workers</Text>
          <Text style={styles.topSub} numberOfLines={1}>
            {currentVendor.CompanyName || currentVendor.VendorName} (Vendor #{currentVendor.VendorId})
          </Text>
        </View>
        <TouchableOpacity
          style={styles.quickKeyBtn}
          onPress={() => loadWorkers(true)}
          activeOpacity={0.7}>
          <Text style={styles.quickKeyText}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs Row (Scrollable to comfortably fit all 4 sections) */}
      <View style={styles.tabContainerWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'list' && styles.tabBtnActive]}
            onPress={() => setActiveTab('list')}
            activeOpacity={0.8}>
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'list' && styles.tabBtnTextActive,
              ]}>
              👥 Workers ({workers.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'assign' && styles.tabBtnActiveAssign]}
            onPress={() => {
              setActiveTab('assign');
              loadAssignData();
            }}
            activeOpacity={0.8}>
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'assign' && styles.tabBtnTextActive,
              ]}>
              ⚡ Assign Stations
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'assigned' && styles.tabBtnActiveAssigned]}
            onPress={() => {
              setActiveTab('assigned');
              loadAssignedDetails(true);
            }}
            activeOpacity={0.8}>
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'assigned' && styles.tabBtnTextActive,
              ]}>
              📋 Assigned ({assignedDetails.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'create' && styles.tabBtnActiveCreate]}
            onPress={() => setActiveTab('create')}
            activeOpacity={0.8}>
            <Text
              style={[
                styles.tabBtnText,
                activeTab === 'create' && styles.tabBtnTextActive,
              ]}>
              ➕ Add Worker
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Main Content */}
      {activeTab === 'list' ? (
        <View style={{ flex: 1 }}>
          {/* Search Bar */}
          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by worker name, phone, or ID..."
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {isLoadingList && !isRefreshing ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color="#0D9488" />
              <Text style={styles.centerText}>Fetching workers from server...</Text>
            </View>
          ) : fetchError ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>🌐</Text>
              <Text style={styles.emptyTitle}>Internet Connection Required</Text>
              <Text style={styles.emptySub}>{fetchError}</Text>
              <TouchableOpacity
                style={styles.registerFirstBtn}
                onPress={() => loadWorkers(false)}
                activeOpacity={0.85}>
                <Text style={styles.registerFirstBtnText}>🔄 Retry Loading</Text>
              </TouchableOpacity>
            </View>
          ) : filteredWorkers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>👷</Text>
              <Text style={styles.emptyTitle}>
                {searchQuery ? 'No Workers Match Search' : 'No Field Workers Registered Yet'}
              </Text>
              <Text style={styles.emptySub}>
                {searchQuery
                  ? 'No workers match your current search query.'
                  : 'Register field technicians under your vendor account so they can sign in and complete installations.'}
              </Text>
              {!searchQuery && (
                <TouchableOpacity
                  style={styles.registerFirstBtn}
                  onPress={() => setActiveTab('create')}
                  activeOpacity={0.85}>
                  <Text style={styles.registerFirstBtnText}>➕ Register New Worker</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <FlatList
              data={filteredWorkers}
              keyExtractor={item => String(item.VendorWorkerUserId)}
              renderItem={renderWorkerCard}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={() => loadWorkers(true)}
                  colors={['#0D9488']}
                />
              }
            />
          )}
        </View>
      ) : activeTab === 'assign' ? (
        <View style={{ flex: 1 }}>
          {isLoadingAssignData && dropdownWorkers.length === 0 && dropdownSubstations.length === 0 ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color="#4F46E5" />
              <Text style={styles.centerText}>Loading workers and substations...</Text>
            </View>
          ) : assignError ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>⚠️</Text>
              <Text style={styles.emptyTitle}>Unable to Load Dropdown Data</Text>
              <Text style={styles.emptySub}>{assignError}</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={loadAssignData}
                activeOpacity={0.85}>
                <Text style={styles.retryBtnText}>🔄 Retry Loading</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.assignScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>

              {/* Step 1: Select Field Worker */}
              <View style={[styles.assignStepCard, selectedWorkerObj && styles.assignStepCardDone]}>
                <View style={styles.assignStepHeader}>
                  <View style={[styles.assignStepNumber, selectedWorkerObj && styles.assignStepNumberDone]}>
                    <Text style={[styles.assignStepNumberText, selectedWorkerObj && styles.assignStepNumberTextDone]}>
                      {selectedWorkerObj ? '✓' : '1'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assignStepTitle}>
                      {selectedWorkerObj ? 'Step 1: Field Worker Selected' : 'Step 1: Select Field Worker'}
                    </Text>
                    <Text style={styles.assignStepSubtitle}>
                      {selectedWorkerObj
                        ? 'Substations will be assigned to this field technician'
                        : 'First choose the worker who will receive assignments'}
                    </Text>
                  </View>
                  {selectedWorkerObj && (
                    <TouchableOpacity
                      style={styles.changeWorkerBtn}
                      onPress={() => {
                        setSelectedWorkerId(null);
                        setSelectedExcelDataIds([]);
                      }}
                      activeOpacity={0.8}>
                      <Text style={styles.changeWorkerBtnText}>Change 🔁</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {selectedWorkerObj ? (
                  <View style={styles.selectedWorkerCard}>
                    <View style={styles.selectedWorkerAvatar}>
                      <Text style={styles.selectedWorkerAvatarText}>👷</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.selectedWorkerName}>{selectedWorkerObj.WorkerName}</Text>
                      <Text style={styles.selectedWorkerId}>Worker ID: #{selectedWorkerObj.WorkerId}</Text>
                    </View>
                    <View style={styles.selectedWorkerBadge}>
                      <Text style={styles.selectedWorkerBadgeText}>Ready for Step 2</Text>
                    </View>
                  </View>
                ) : (
                  <View>
                    {dropdownWorkers.length === 0 ? (
                      <View style={styles.noWorkersNoticeBox}>
                        <Text style={{ fontSize: 24, marginBottom: 6 }}>👷</Text>
                        <Text style={styles.noWorkersNoticeTitle}>No Field Workers Found</Text>
                        <Text style={styles.noWorkersNoticeDesc}>
                          Please register at least one worker under your vendor account first.
                        </Text>
                        <TouchableOpacity
                          style={styles.goToAddWorkerBtn}
                          onPress={() => setActiveTab('create')}
                          activeOpacity={0.8}>
                          <Text style={styles.goToAddWorkerBtnText}>➕ Register New Worker</Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.workerSelectContainer}>
                        <Text style={styles.workerSelectLabel}>
                          Choose a field worker to assign:
                        </Text>
                        <View style={styles.workerSelectList}>
                          {dropdownWorkers.map(w => (
                            <TouchableOpacity
                              key={String(w.WorkerId)}
                              style={styles.workerSelectItem}
                              onPress={() => {
                                setSelectedWorkerId(w.WorkerId);
                              }}
                              activeOpacity={0.75}>
                              <View style={styles.workerSelectAvatar}>
                                <Text style={{ fontSize: 18 }}>👷</Text>
                              </View>
                              <View style={{ flex: 1, marginLeft: 10 }}>
                                <Text style={styles.workerSelectItemName}>{w.WorkerName}</Text>
                                <Text style={styles.workerSelectItemId}>Worker ID: #{w.WorkerId}</Text>
                              </View>
                              <View style={styles.workerSelectActionBtn}>
                                <Text style={styles.workerSelectActionBtnText}>Select →</Text>
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>

                        {dropdownWorkers.length > 3 && (
                          <TouchableOpacity
                            style={styles.searchAllWorkersBtn}
                            onPress={() => setWorkerPickerVisible(true)}
                            activeOpacity={0.8}>
                            <Text style={styles.searchAllWorkersBtnText}>
                              🔍 Search / Filter All Workers ({dropdownWorkers.length})
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Step 2: Select Substations (Only Unlocked After Worker is Selected) */}
              <View style={[styles.assignStepCard, !selectedWorkerObj && styles.assignStepCardLocked]}>
                <View style={styles.assignStepHeader}>
                  <View style={[styles.assignStepNumber, !selectedWorkerObj && styles.assignStepNumberLocked]}>
                    <Text style={[styles.assignStepNumberText, !selectedWorkerObj && styles.assignStepNumberTextLocked]}>
                      2
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.assignStepTitle, !selectedWorkerObj && styles.assignStepTitleLocked]}>
                      Step 2: Select Substations to Assign
                    </Text>
                    <Text style={styles.assignStepSubtitle}>
                      {selectedWorkerObj
                        ? `Select one or multiple substations for ${selectedWorkerObj.WorkerName}`
                        : 'Locked until a field worker is chosen above'}
                    </Text>
                  </View>
                </View>

                {!selectedWorkerObj ? (
                  <View style={styles.lockedStepBox}>
                    <Text style={styles.lockedStepIcon}>🔒</Text>
                    <Text style={styles.lockedStepTitle}>First, Select a Field Worker Above</Text>
                    <Text style={styles.lockedStepSubtitle}>
                      Substations will unlock automatically once you select a field technician in Step 1.
                    </Text>
                  </View>
                ) : (
                  <View>
                    {/* Active Worker Assignment Banner */}
                    <View style={styles.activeWorkerBanner}>
                      <Text style={styles.activeWorkerBannerText}>
                        ⚡ Assigning to: <Text style={{ fontWeight: '800' }}>{selectedWorkerObj.WorkerName}</Text> (ID #{selectedWorkerObj.WorkerId})
                      </Text>
                    </View>

                    {/* Substation Search */}
                    <View style={styles.assignSearchRow}>
                      <Text style={styles.searchIcon}>🔍</Text>
                      <TextInput
                        style={styles.searchInput}
                        value={substationSearchQuery}
                        onChangeText={setSubstationSearchQuery}
                        placeholder="Search substations by name, ID..."
                        placeholderTextColor="#94A3B8"
                        autoCapitalize="none"
                      />
                      {substationSearchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSubstationSearchQuery('')}>
                          <Text style={styles.searchClear}>✕</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Counter & Select All Actions */}
                    <View style={styles.selectionBar}>
                      <View style={styles.selectedCountBadge}>
                        <Text style={styles.selectedCountBadgeText}>
                          ✓ {selectedExcelDataIds.length} of {dropdownSubstations.length} Selected
                        </Text>
                      </View>
                      <View style={styles.quickSelectActions}>
                        <TouchableOpacity
                          style={styles.quickActionBtn}
                          onPress={handleSelectAllSubstations}
                          activeOpacity={0.7}>
                          <Text style={styles.quickActionBtnText}>Select All</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.quickActionBtn}
                          onPress={handleClearAllSubstations}
                          activeOpacity={0.7}>
                          <Text style={styles.quickActionBtnText}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Substations List */}
                    {filteredSubstations.length === 0 ? (
                      <View style={styles.emptySubstationsBox}>
                        <Text style={styles.emptySubstationsEmoji}>⚡</Text>
                        <Text style={styles.emptySubstationsTitle}>
                          {substationSearchQuery
                            ? 'No Substations Match Search'
                            : 'No Substations Available'}
                        </Text>
                        <Text style={styles.emptySubstationsDesc}>
                          {substationSearchQuery
                            ? 'Try different keywords or clear search.'
                            : 'No pending substations found in dropdown.'}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.substationsListContainer}>
                        {filteredSubstations.map(station => {
                          const isSelected = selectedExcelDataIds.includes(station.ExcelDataId);
                          return (
                            <TouchableOpacity
                              key={String(station.ExcelDataId)}
                              style={[
                                styles.substationRow,
                                isSelected && styles.substationRowSelected,
                              ]}
                              onPress={() => handleToggleSubstation(station.ExcelDataId)}
                              activeOpacity={0.75}>
                              <View
                                style={[
                                  styles.checkboxBox,
                                  isSelected && styles.checkboxBoxSelected,
                                ]}>
                                {isSelected && <Text style={styles.checkmarkText}>✓</Text>}
                              </View>
                              <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text
                                  style={[
                                    styles.substationName,
                                    isSelected && styles.substationNameSelected,
                                  ]}
                                  numberOfLines={1}>
                                  {station.StationName}
                                </Text>
                                <View style={styles.substationMetaRow}>
                                  <View style={styles.substationMetaBadge}>
                                    <Text style={styles.substationMetaBadgeText}>
                                      Excel ID: #{station.ExcelDataId}
                                    </Text>
                                  </View>
                                  <View style={styles.substationMetaBadge}>
                                    <Text style={styles.substationMetaBadgeText}>
                                      Assignment #{station.VendorAssignmentId}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* Step 3: Assignment Summary & Submission (Only Shown When Worker is Selected) */}
              {selectedWorkerObj && (
                <View style={styles.assignSubmitCard}>
                  <Text style={styles.assignSubmitCardTitle}>📋 Assignment Summary</Text>
                  <View style={styles.submitMetaRow}>
                    <Text style={styles.submitMetaLabel}>Worker:</Text>
                    <Text style={styles.submitMetaVal} numberOfLines={1}>
                      {selectedWorkerObj.WorkerName} (ID #{selectedWorkerObj.WorkerId})
                    </Text>
                  </View>
                  <View style={styles.submitMetaRow}>
                    <Text style={styles.submitMetaLabel}>Substations:</Text>
                    <Text style={styles.submitMetaValBold}>
                      {selectedExcelDataIds.length} substation(s) selected
                    </Text>
                  </View>
                  <View style={styles.submitMetaRow}>
                    <Text style={styles.submitMetaLabel}>Created By:</Text>
                    <Text style={styles.submitMetaVal} numberOfLines={1}>
                      {createdByUserName}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.submitAssignmentBtn,
                      (selectedExcelDataIds.length === 0 || isSubmittingAssign) &&
                        styles.submitAssignmentBtnDisabled,
                    ]}
                    onPress={handleSubmitAssignment}
                    disabled={selectedExcelDataIds.length === 0 || isSubmittingAssign}
                    activeOpacity={0.85}>
                    {isSubmittingAssign ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.submitAssignmentBtnText}>
                        {selectedExcelDataIds.length === 0
                          ? 'Select Substations Above to Assign'
                          : `⚡ Assign ${selectedExcelDataIds.length} Substation(s) to ${selectedWorkerObj.WorkerName}`}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          )}

          {/* Worker Picker Modal */}
          <Modal
            visible={workerPickerVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setWorkerPickerVisible(false)}>
            <View style={styles.modalOverlay}>
              <View style={styles.modalCardWide}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Select Field Worker</Text>
                  <TouchableOpacity
                    onPress={() => setWorkerPickerVisible(false)}
                    activeOpacity={0.7}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modalSearchRow}>
                  <Text style={styles.searchIcon}>🔍</Text>
                  <TextInput
                    style={styles.searchInput}
                    value={workerSearchQuery}
                    onChangeText={setWorkerSearchQuery}
                    placeholder="Search by worker name, phone, or ID..."
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="none"
                  />
                  {workerSearchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setWorkerSearchQuery('')}>
                      <Text style={styles.searchClear}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <ScrollView style={{ maxHeight: 360 }}>
                  {filteredDropdownWorkers.length === 0 ? (
                    <View style={{ padding: 24, alignItems: 'center' }}>
                      <Text style={{ fontSize: 24, marginBottom: 8 }}>👷</Text>
                      <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '600' }}>
                        No workers found
                      </Text>
                    </View>
                  ) : (
                    filteredDropdownWorkers.map(w => {
                      const isSelected = selectedWorkerId === w.WorkerId;
                      return (
                        <TouchableOpacity
                          key={String(w.WorkerId)}
                          style={[
                            styles.workerPickerRow,
                            isSelected && styles.workerPickerRowSelected,
                          ]}
                          onPress={() => {
                            setSelectedWorkerId(w.WorkerId);
                            setWorkerPickerVisible(false);
                          }}
                          activeOpacity={0.8}>
                          <View style={styles.workerPickerAvatar}>
                            <Text style={styles.workerPickerAvatarText}>👷</Text>
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={styles.workerPickerName}>{w.WorkerName}</Text>
                            <Text style={styles.workerPickerId}>Worker ID: #{w.WorkerId}</Text>
                          </View>
                          {isSelected && (
                            <View style={styles.workerPickerCheck}>
                              <Text style={styles.workerPickerCheckText}>✓ Selected</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })
                  )}
                </ScrollView>
              </View>
            </View>
          </Modal>
        </View>
      ) : activeTab === 'assigned' ? (
        <View style={{ flex: 1 }}>
          {/* Assigned Header Banner */}
          <View style={styles.assignedHeaderBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.assignedHeaderTitle}>Assigned Substations</Text>
              <Text style={styles.assignedHeaderSub}>
                Real-time mapping of substations allocated to field workers
              </Text>
            </View>
            <TouchableOpacity
              style={styles.assignNewBtn}
              onPress={() => {
                setActiveTab('assign');
                loadAssignData();
              }}
              activeOpacity={0.8}>
              <Text style={styles.assignNewBtnText}>⚡ + Assign More</Text>
            </TouchableOpacity>
          </View>

          {/* Worker Filter Banner (if a worker is filtered) */}
          {selectedWorkerFilterId !== null && (
            <View style={styles.activeWorkerFilterBanner}>
              <View style={styles.activeWorkerFilterLeft}>
                <Text style={styles.activeWorkerFilterEmoji}>👷</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activeWorkerFilterText}>
                    Filtered by:{' '}
                    <Text style={{ fontWeight: '800' }}>
                      {dropdownWorkers.find(w => w.WorkerId === selectedWorkerFilterId)?.WorkerName ||
                        workers.find(w => w.VendorWorkerUserId === selectedWorkerFilterId)?.UserName ||
                        `Worker #${selectedWorkerFilterId}`}
                    </Text>
                  </Text>
                  <Text style={styles.activeWorkerFilterSub}>
                    Showing {filteredAssignedDetails.length} assigned substation(s)
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.clearFilterBtn}
                onPress={() => setSelectedWorkerFilterId(null)}
                activeOpacity={0.7}>
                <Text style={styles.clearFilterBtnText}>✕ Clear</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Search Bar for Assigned */}
          <View style={styles.searchRow}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={styles.searchInput}
              value={assignedSearchQuery}
              onChangeText={setAssignedSearchQuery}
              placeholder="Search by station, worker, taluk, AE/JE..."
              placeholderTextColor="#94A3B8"
              autoCapitalize="none"
            />
            {assignedSearchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setAssignedSearchQuery('')}>
                <Text style={styles.searchClear}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Filter Chips: All, Pending, Completed */}
          <View style={styles.assignedFiltersRow}>
            <TouchableOpacity
              style={[
                styles.assignedFilterChip,
                assignedStatusFilter === 'ALL' && styles.assignedFilterChipActive,
              ]}
              onPress={() => setAssignedStatusFilter('ALL')}
              activeOpacity={0.75}>
              <Text
                style={[
                  styles.assignedFilterChipText,
                  assignedStatusFilter === 'ALL' && styles.assignedFilterChipTextActive,
                ]}>
                All ({assignedDetails.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.assignedFilterChip,
                assignedStatusFilter === '1' && styles.assignedFilterChipActiveAmber,
              ]}
              onPress={() => setAssignedStatusFilter('1')}
              activeOpacity={0.75}>
              <Text
                style={[
                  styles.assignedFilterChipText,
                  assignedStatusFilter === '1' && styles.assignedFilterChipTextActiveAmber,
                ]}>
                ⏳ Pending ({pendingAssignedCount})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.assignedFilterChip,
                assignedStatusFilter === '3' && styles.assignedFilterChipActiveGreen,
              ]}
              onPress={() => setAssignedStatusFilter('3')}
              activeOpacity={0.75}>
              <Text
                style={[
                  styles.assignedFilterChipText,
                  assignedStatusFilter === '3' && styles.assignedFilterChipTextActiveGreen,
                ]}>
                ✓ Completed ({completedAssignedCount})
              </Text>
            </TouchableOpacity>
          </View>

          {/* Assigned Cards List */}
          {isLoadingAssignedDetails && !isRefreshing ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color="#4F46E5" />
              <Text style={styles.centerText}>Loading assigned substation records...</Text>
            </View>
          ) : assignedDetails.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>📋</Text>
              <Text style={styles.emptyTitle}>No Assigned Substations Found</Text>
              <Text style={styles.emptySub}>
                You haven't assigned any substations to field workers yet. Go to the "Assign Stations" tab to allocate substations to your workers.
              </Text>
              <TouchableOpacity
                style={styles.registerFirstBtn}
                onPress={() => {
                  setActiveTab('assign');
                  loadAssignData();
                }}
                activeOpacity={0.85}>
                <Text style={styles.registerFirstBtnText}>⚡ Assign Stations Now</Text>
              </TouchableOpacity>
            </View>
          ) : filteredAssignedDetails.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyEmoji}>🔍</Text>
              <Text style={styles.emptyTitle}>No Matching Assignments</Text>
              <Text style={styles.emptySub}>
                No assigned substations match your filter or search query.
              </Text>
              <TouchableOpacity
                style={styles.registerFirstBtn}
                onPress={() => {
                  setAssignedSearchQuery('');
                  setAssignedStatusFilter('ALL');
                  setSelectedWorkerFilterId(null);
                }}
                activeOpacity={0.85}>
                <Text style={styles.registerFirstBtnText}>✕ Reset All Filters</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={filteredAssignedDetails}
              keyExtractor={item =>
                `assigned-${item.WorkerStationAssignmentId}-${item.ExcelDataId}-${item.WorkerId}`
              }
              renderItem={renderAssignedStationCard}
              contentContainerStyle={styles.assignedListContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={() => loadAssignedDetails(true)}
                  colors={['#4F46E5']}
                />
              }
            />
          )}
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.createContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>👤 Worker Profile Details</Text>
            <Text style={styles.sectionSubtitle}>
              Create a dedicated field worker account linked directly under Vendor #{currentVendor.VendorId}.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>WORKER FULL NAME / USERNAME *</Text>
              <TextInput
                style={styles.textInput}
                value={userName}
                onChangeText={setUserName}
                placeholder="e.g. Praveen Kumar"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>10-DIGIT MOBILE NUMBER *</Text>
              <View style={styles.phoneInputWrap}>
                <View style={styles.phonePrefix}>
                  <Text style={styles.phonePrefixText}>🇮🇳 +91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={mobileNumber}
                  onChangeText={handleMobileNumberChange}
                  placeholder="e.g. 9999955771"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>INITIAL ACCESS PASSWORD *</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={styles.passwordInput}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter access password (min. 6 characters)"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}>
                  <Text style={styles.eyeText}>{showPassword ? 'HIDE' : 'SHOW'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Identity Documents Upload Section */}
          <View style={styles.sectionCard}>
            <View style={styles.docSectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>📄 Identity Documents</Text>
                <Text style={styles.sectionSubtitle}>
                  Upload all 3 required documents for worker compliance and verification.
                </Text>
              </View>
              <View
                style={[
                  styles.progressPill,
                  attachedCount === 3 && styles.progressPillDone,
                ]}>
                <Text
                  style={[
                    styles.progressPillText,
                    attachedCount === 3 && styles.progressPillTextDone,
                  ]}>
                  {attachedCount}/3 Done
                </Text>
              </View>
            </View>

            {/* Document 1: Aadhar Card */}
            {renderDocUploadCard(
              1,
              'Aadhar Card Proof (Doc #1)',
              'Government issued identity card showing photo and UID number.',
              aadharDoc,
              () => setAadharDoc(null),
            )}

            {/* Document 2: PAN Card */}
            {renderDocUploadCard(
              2,
              'PAN Card Proof (Doc #2)',
              'Income tax PAN card verification for contractor documentation.',
              panDoc,
              () => setPanDoc(null),
            )}

            {/* Document 3: Worker Photo */}
            {renderDocUploadCard(
              3,
              'Worker Photograph (Doc #3)',
              'Clear front-facing passport style portrait photo of the technician.',
              workerPhoto,
              () => setWorkerPhoto(null),
            )}
          </View>

          {/* Submit Registration Button */}
          <TouchableOpacity
            style={[
              styles.submitCreateBtn,
              isSubmittingCreate && styles.btnDisabled,
            ]}
            onPress={handleCreateWorker}
            disabled={isSubmittingCreate}
            activeOpacity={0.85}>
            {isSubmittingCreate ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.submitCreateBtnText}>Creating Worker Account...</Text>
              </View>
            ) : (
              <Text style={styles.submitCreateBtnText}>
                🚀 Create Vendor Worker Account
              </Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Edit Worker Details Modal (PUT /apkEditVendorWorker) */}
      <Modal
        visible={editModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>✏️ Edit Worker Details</Text>
              <TouchableOpacity
                onPress={() => setEditModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Update profile information for Worker User ID: #{editingWorker?.VendorWorkerUserId}.
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>WORKER FULL NAME / USERNAME *</Text>
              <TextInput
                style={styles.textInput}
                value={editUserName}
                onChangeText={setEditUserName}
                placeholder="Enter worker username"
                placeholderTextColor="#94A3B8"
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>10-DIGIT MOBILE NUMBER *</Text>
              <View style={styles.phoneInputWrap}>
                <View style={styles.phonePrefix}>
                  <Text style={styles.phonePrefixText}>🇮🇳 +91</Text>
                </View>
                <TextInput
                  style={styles.phoneInput}
                  value={editMobileNumber}
                  onChangeText={handleEditMobileChange}
                  placeholder="Enter 10-digit mobile number"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                  maxLength={10}
                />
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setEditModalVisible(false)}
                disabled={isSubmittingEdit}
                activeOpacity={0.7}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSubmitBtn,
                  styles.modalSubmitBtnTeal,
                  isSubmittingEdit && styles.btnDisabled,
                ]}
                onPress={handleSaveEditWorker}
                disabled={isSubmittingEdit}
                activeOpacity={0.85}>
                {isSubmittingEdit ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal (POST /apkchangeVendorWorkerUserPassword) */}
      <Modal
        visible={passwordModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setPasswordModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🔑 Change Worker Password</Text>
              <TouchableOpacity
                onPress={() => setPasswordModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              {targetWorker
                ? `Update login credentials for "${targetWorker.UserName}" (Worker User ID: #${targetWorker.VendorWorkerUserId}).`
                : 'Enter worker user ID to change password under your vendor jurisdiction.'}
            </Text>

            {!targetWorker ? (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>WORKER USER ID *</Text>
                <TextInput
                  style={styles.textInput}
                  value={manualWorkerId}
                  onChangeText={setManualWorkerId}
                  placeholder="e.g. 11"
                  placeholderTextColor="#94A3B8"
                  keyboardType="number-pad"
                />
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>NEW PASSWORD *</Text>
              <View style={styles.passwordWrap}>
                <TextInput
                  style={styles.passwordInput}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Enter new password"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showNewPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowNewPassword(!showNewPassword)}>
                  <Text style={styles.eyeText}>{showNewPassword ? 'HIDE' : 'SHOW'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>CONFIRM NEW PASSWORD *</Text>
              <TextInput
                style={styles.textInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="Re-enter new password"
                placeholderTextColor="#94A3B8"
                secureTextEntry={!showNewPassword}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setPasswordModalVisible(false)}
                disabled={isSubmittingPassword}
                activeOpacity={0.7}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalSubmitBtn,
                  isSubmittingPassword && styles.btnDisabled,
                ]}
                onPress={handleChangePassword}
                disabled={isSubmittingPassword}
                activeOpacity={0.85}>
                {isSubmittingPassword ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalSubmitText}>Save Password</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  backBtnText: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 13,
  },
  topTitleWrap: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 10,
  },
  topTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  topSub: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  quickKeyBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0FDFA',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  quickKeyText: {
    fontSize: 16,
  },
  tabContainerWrap: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  tabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  tabBtnActive: {
    backgroundColor: '#2563EB',
  },
  tabBtnActiveAssign: {
    backgroundColor: '#4F46E5',
  },
  tabBtnActiveAssigned: {
    backgroundColor: '#0D9488',
  },
  tabBtnActiveCreate: {
    backgroundColor: '#D97706',
  },
  tabBtnText: {
    color: '#64748B',
    fontSize: 12.5,
    fontWeight: '700',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    height: 44,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    paddingVertical: 0,
  },
  searchClear: {
    color: '#94A3B8',
    fontSize: 14,
    paddingHorizontal: 6,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  centerText: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 60,
  },
  emptyEmoji: {
    fontSize: 52,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
  },
  registerFirstBtn: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  registerFirstBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  workerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  workerCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  workerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#0D9488',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  workerAvatarImg: {
    width: 48,
    height: 48,
  },
  workerAvatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  workerMetaWrap: {
    flex: 1,
  },
  workerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  workerName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    flex: 1,
    marginRight: 6,
  },
  workerRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  workerRoleActive: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  workerRoleDisabled: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  workerRoleText: {
    fontSize: 10,
    fontWeight: '800',
  },
  workerTextActive: {
    color: '#0F766E',
  },
  workerTextDisabled: {
    color: '#DC2626',
  },
  workerIdText: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  boldText: {
    fontWeight: '800',
    color: '#0F172A',
  },
  workerPhone: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '700',
    marginTop: 2,
  },
  workerDate: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  workerCardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  editCardBtn: {
    backgroundColor: '#F0FDFA',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#99F6E4',
  },
  editCardBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F766E',
  },
  changePasswordCardBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  changePasswordCardBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  createContent: {
    padding: 16,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginBottom: 14,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  phoneInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  phonePrefix: {
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
  },
  phonePrefixText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  passwordWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  eyeBtn: {
    paddingHorizontal: 12,
  },
  eyeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2563EB',
  },
  docSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  progressPill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  progressPillDone: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
  },
  progressPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  progressPillTextDone: {
    color: '#0F766E',
  },
  docCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  docCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  docTypeBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  docTypeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#475569',
  },
  docTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  docDesc: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 10,
    lineHeight: 16,
  },
  pickerActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pickButtonCamera: {
    flex: 1,
    backgroundColor: '#0D9488',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  pickButtonCameraText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  pickButtonGallery: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  pickButtonGalleryText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '700',
  },
  previewContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  previewImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: '#F1F5F9',
  },
  previewInfo: {
    flex: 1,
  },
  previewStatus: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
  },
  previewFileName: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  previewFileSize: {
    fontSize: 10,
    color: '#94A3B8',
  },
  previewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  retakeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  retakeBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  changeGalleryBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  changeGalleryBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0F172A',
  },
  removeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },
  removeBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#DC2626',
  },
  submitCreateBtn: {
    backgroundColor: '#0D9488',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#0D9488',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitCreateBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  btnDisabled: {
    opacity: 0.65,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalClose: {
    fontSize: 18,
    color: '#94A3B8',
    padding: 4,
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 13,
  },
  modalSubmitBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  modalSubmitBtnTeal: {
    backgroundColor: '#0D9488',
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  // Substation Assignment Styles
  assignCardBtn: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  assignCardBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338CA',
  },
  assignScrollContent: {
    padding: 16,
    paddingBottom: 50,
  },
  assignStepCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  assignStepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  assignStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignStepNumberText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  assignStepTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  assignStepSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  selectedWorkerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  selectedWorkerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  selectedWorkerAvatarText: {
    fontSize: 20,
  },
  selectedWorkerName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  selectedWorkerId: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  changeWorkerBtn: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  changeWorkerBtnText: {
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '700',
  },
  assignStepCardDone: {
    borderColor: '#86EFAC',
    backgroundColor: '#F0FDF4',
  },
  assignStepNumberDone: {
    backgroundColor: '#16A34A',
  },
  assignStepNumberTextDone: {
    color: '#FFFFFF',
  },
  selectedWorkerBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#86EFAC',
  },
  selectedWorkerBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803D',
  },
  noWorkersNoticeBox: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noWorkersNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  noWorkersNoticeDesc: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 12,
  },
  goToAddWorkerBtn: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  goToAddWorkerBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  workerSelectContainer: {
    marginTop: 4,
  },
  workerSelectLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
  },
  workerSelectList: {
    gap: 8,
  },
  workerSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  workerSelectAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerSelectItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  workerSelectItemId: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  workerSelectActionBtn: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  workerSelectActionBtnText: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '800',
  },
  searchAllWorkersBtn: {
    marginTop: 10,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
  },
  searchAllWorkersBtnText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  assignStepCardLocked: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  assignStepNumberLocked: {
    backgroundColor: '#CBD5E1',
  },
  assignStepNumberTextLocked: {
    color: '#64748B',
  },
  assignStepTitleLocked: {
    color: '#64748B',
  },
  lockedStepBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
  },
  lockedStepIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  lockedStepTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 4,
  },
  lockedStepSubtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: '90%',
  },
  activeWorkerBanner: {
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  activeWorkerBannerText: {
    fontSize: 12,
    color: '#3730A3',
  },
  selectWorkerPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
  },
  selectWorkerPlaceholderText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  selectWorkerChevron: {
    fontSize: 12,
    color: '#64748B',
  },
  assignSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    height: 42,
    marginBottom: 10,
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  selectedCountBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  selectedCountBadgeText: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '800',
  },
  quickSelectActions: {
    flexDirection: 'row',
    gap: 8,
  },
  quickActionBtn: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  quickActionBtnText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  substationsListContainer: {
    gap: 8,
  },
  substationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  substationRowSelected: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxBoxSelected: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  checkmarkText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  substationName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  substationNameSelected: {
    color: '#15803D',
  },
  substationMetaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  substationMetaBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  substationMetaBadgeText: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
  emptySubstationsBox: {
    alignItems: 'center',
    padding: 24,
  },
  emptySubstationsEmoji: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptySubstationsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubstationsDesc: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  assignSubmitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  assignSubmitCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 10,
  },
  submitMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  submitMetaLabel: {
    fontSize: 12,
    color: '#64748B',
  },
  submitMetaVal: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '600',
    maxWidth: '65%',
  },
  submitMetaValBold: {
    fontSize: 13,
    color: '#4F46E5',
    fontWeight: '800',
  },
  submitAssignmentBtn: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  submitAssignmentBtnDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitAssignmentBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  retryBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  modalCardWide: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  modalSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    height: 42,
    marginBottom: 12,
  },
  workerPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  workerPickerRowSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#A5B4FC',
  },
  workerPickerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  workerPickerAvatarText: {
    fontSize: 18,
  },
  workerPickerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  workerPickerId: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  workerPickerCheck: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  workerPickerCheckText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  workerAssignedBadge: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  workerAssignedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338CA',
  },
  assignedHeaderBanner: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assignedHeaderTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  assignedHeaderSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  assignNewBtn: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    marginLeft: 10,
  },
  assignNewBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  activeWorkerFilterBanner: {
    backgroundColor: '#EEF2FF',
    borderBottomWidth: 1,
    borderBottomColor: '#C7D2FE',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  activeWorkerFilterLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activeWorkerFilterEmoji: {
    fontSize: 18,
    marginRight: 8,
  },
  activeWorkerFilterText: {
    fontSize: 12,
    color: '#312E81',
  },
  activeWorkerFilterSub: {
    fontSize: 10,
    color: '#6366F1',
    marginTop: 1,
  },
  clearFilterBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  clearFilterBtnText: {
    fontSize: 11,
    color: '#4338CA',
    fontWeight: '700',
  },
  assignedFiltersRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  assignedFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  assignedFilterChipActive: {
    backgroundColor: '#1E293B',
    borderColor: '#1E293B',
  },
  assignedFilterChipActiveAmber: {
    backgroundColor: '#D97706',
    borderColor: '#D97706',
  },
  assignedFilterChipActiveGreen: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  assignedFilterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
  },
  assignedFilterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  assignedFilterChipTextActiveAmber: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  assignedFilterChipTextActiveGreen: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  assignedListContent: {
    padding: 16,
    paddingBottom: 36,
  },
  assignedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  assignedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stationIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stationIconText: {
    fontSize: 18,
  },
  stationNameWrap: {
    flex: 1,
  },
  assignedStationName: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  stationBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  voltageBadge: {
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  voltageBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#7E22CE',
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeCompleted: {
    backgroundColor: '#DCFCE7',
  },
  statusBadgePending: {
    backgroundColor: '#FEF3C7',
  },
  statusBadgeOther: {
    backgroundColor: '#F1F5F9',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  statusTextCompleted: {
    color: '#15803D',
  },
  statusTextPending: {
    color: '#B45309',
  },
  statusTextOther: {
    color: '#475569',
  },
  assignedWorkerBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    marginBottom: 10,
  },
  assignedWorkerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  assignedWorkerIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedWorkerIconEmoji: {
    fontSize: 16,
  },
  assignedWorkerHeaderLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#4338CA',
    letterSpacing: 0.5,
  },
  assignedWorkerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1B4B',
  },
  workerCallPill: {
    backgroundColor: '#10B981',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
  },
  workerCallPillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  assignedWorkerDetailsGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
  },
  assignedWorkerCol: {
    flex: 1,
  },
  assignedWorkerMetaLabel: {
    fontSize: 9,
    color: '#64748B',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  assignedWorkerMetaVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  assignedLocationSection: {
    marginBottom: 8,
  },
  locationDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  locationIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  locationText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
    flex: 1,
  },
  addressText: {
    fontSize: 10,
    color: '#64748B',
    marginLeft: 16,
    marginTop: 1,
  },
  aejeSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F0FDFA',
    borderWidth: 1,
    borderColor: '#CCFBF1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  aejeLabel: {
    fontSize: 8.5,
    fontWeight: '800',
    color: '#0F766E',
    letterSpacing: 0.5,
  },
  aejeName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#134E4A',
  },
  aejeCallBtn: {
    backgroundColor: '#0D9488',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  aejeCallBtnText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  assignedCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  footerMetaCol: {
    flex: 1,
  },
  footerMetaLabel: {
    fontSize: 8.5,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
  },
  footerMetaVal: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  mapBtn: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginLeft: 8,
  },
  mapBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563EB',
  },
});
