export interface LoginRequest {
  contactNumber: string;
  password: string;
}

export interface VendorProfile {
  // Common identity & Role
  VendorId: number;
  RoleId?: number; // 8 = Vendor, 9 = VendorWorker
  userType?: 'Vendor' | 'VendorWorker' | string;

  // Vendor specific attributes (RoleId: 8)
  VendorName?: string;
  CompanyName?: string | null;
  ContactPerson?: string;
  ContactNumber?: string;
  EmailAddress?: string | null;
  GSTNumber?: string | null;
  Address?: string | null;
  City?: string | null;
  State?: string | null;
  Remarks?: string | null;
  IsDisabled?: boolean;
  CreatedAt?: string;
  UpdatedAt?: string | null;
  CreatedByUserName?: string | null;
  UpdatedByUserName?: string | null;

  // Vendor Worker specific attributes (RoleId: 9)
  VendorWorkerId?: number;
  WorkerId?: number;
  UserName?: string;
  MobileNumber?: string;
  CreatedByUserId?: number | null;
  CreatedByVendorId?: number | null;
  AdminCreatedAt?: string | null;
  VendorCreatedAt?: string | null;
}

export interface LoginResponse {
  status: boolean;
  message: string;
  userType: 'Vendor' | 'VendorWorker' | string;
  data: VendorProfile;
}

export interface StationItem {
  VendorStationAssignmentId: number;
  VendorAssignmentId: number;
  ExcelDataId: number;
  VendorStatusId: number;
  IsDisabled: boolean;
  CreatedAt: string;
  UpdatedAt: string | null;
  Station: string;
  Taluk: string;
  VoltageClass: string;
  InChangreAEJEname: string;
  ContactNumber: string;
  SubStationAddress: string;
  PinCode: string;
  Latitude: string;
  Longitude: string;
  Zone: string;
  Circle: string;
  Division: string;
  RouteStationStatusId: number;
  StatusId: number;
  VisitedAt: string;
  StationRemarks: string | null;
  StationSubmissionId: number;
  SubmissionRemarks: string;
  SubmissionCreatedAt: string;
  SubmissionUpdatedAt: string | null;
  CreatedByDriverId: number;
  SwitchSerialNumber: string;
  ResilientSerialNumber: string;
  SwitchFirmWareNumber?: string;
  WorkerStationAssignmentId?: number;
  WorkerId?: number;
  WorkerName?: string | null;
  VendorStatusName?: string;
  PendingFileTypes?: VendorFileType[];
  PendingFileTypeIds?: VendorFileType[];
  InstallationSubmissionId?: number | null;
  InstallationSubmissionStatusId?: number | null;
  InstallationSubmissionStatusName?: string | null;
  InstallationRemarks?: string | null;
}

export interface AssignmentItem {
  vendorAssignmentId: number;
  vendorId: number;
  zone: string;
  circle: string;
  division: string;
  vendorStatusId: number;
  assignedAt: string;
  stationCount: number;
  completedStationCount: number;
  pendingStationCount: number;
  stations: StationItem[];
}

export interface VendorBrief {
  VendorId: number;
  VendorName: string;
  CompanyName: string;
  ContactPerson: string;
  ContactNumber: string;
  EmailAddress: string;
}

export interface FetchVendorDetailResult {
  vendor: VendorBrief;
  assignments: AssignmentItem[];
}

export interface FetchVendorDetailResponse {
  status: boolean;
  message: string;
  result: FetchVendorDetailResult;
}

export interface CompletedStationFile {
  installationSubmissionFileId: number;
  fileTypeId: number;
  fileTypeName: string;
  fileName: string;
}

export interface CompletedStationItem {
  VendorStationAssignmentId: number;
  VendorAssignmentId: number;
  ExcelDataId: number;
  VendorStatusId: number;
  CreatedAt: string;
  UpdatedAt: string | null;
  VendorId: number;
  Zone: string;
  Circle: string;
  Division: string;
  AssignedAt: string;
  VendorName: string;
  CompanyName: string;
  ContactPerson: string;
  VendorContactNumber: string;
  VendorEmailAddress: string;
  Station: string;
  Taluk: string;
  VoltageClass: string;
  InChangreAEJEname: string;
  StationContactNumber: string;
  SubStationAddress: string;
  PinCode: string;
  Latitude: string;
  Longitude: string;
  RouteStationStatusId: number;
  StatusId: number;
  VisitedAt: string | null;
  StationRemarks: string | null;
  StationSubmissionId: number | null;
  SubmissionRemarks: string | null;
  SubmissionCreatedAt: string | null;
  SubmissionUpdatedAt: string | null;
  CreatedByDriverId: number | null;
  SwitchSerialNumber: string | null;
  ResilientSerialNumber: string | null;
  SwitchFirmWareNumber?: string | null;
  InstallationSubmissionId: number | null;
  InstallationStatusId: number | null;
  InstallationCreatedAt: string | null;
  InstallationUpdatedAt: string | null;
  InstallationCreatedByUserName: string | null;
  InstallationUpdatedByUserName: string | null;
  InstallationRemarks: string | null;
  InstallationVendorId: number | null;
  files: CompletedStationFile[];
  VendorStatusName?: string;
  PendingFileTypes?: VendorFileType[];
  WorkerName?: string | null;
  WorkerId?: number;
}

export interface FetchCompletedStationsResponse {
  status: boolean;
  message: string;
  data: CompletedStationItem[];
}

export interface DashboardCountData {
  VendorId: number;
  VendorName: string;
  TotalAssignedStationCount: string;
  PendingInstallationCount: string;
  CompletedInstallationCount: string;
  CompletedInstallationPercentage: string;
}

export interface FetchDashboardCountResponse {
  status: boolean;
  data: DashboardCountData;
}

export interface VendorFileType {
  VendorFileTypeId: number;
  VendorFileTypeName: string;
}

export const DEFAULT_FILE_TYPES: VendorFileType[] = [
  { VendorFileTypeId: 6, VendorFileTypeName: 'RTU/SAS Panel Photo' },
  { VendorFileTypeId: 4, VendorFileTypeName: 'Rack Photo' },
  { VendorFileTypeId: 8, VendorFileTypeName: 'LIU OFC Splicing Photo' },
  { VendorFileTypeId: 5, VendorFileTypeName: 'User End Point Photo' },
  { VendorFileTypeId: 10, VendorFileTypeName: 'NumberingPhoto' },
  { VendorFileTypeId: 9, VendorFileTypeName: 'Configuration Photo' },
  { VendorFileTypeId: 7, VendorFileTypeName: 'Annexure-11' },
  { VendorFileTypeId: 11, VendorFileTypeName: 'SwitchSerialNumber' },
  { VendorFileTypeId: 12, VendorFileTypeName: 'ResilientSerialNumber' },
];

export interface FetchAssignStationDetailDpdownResponse {
  status: boolean;
  message: string;
  result: VendorFileType[];
}

export interface InstallationSubmissionResponse {
  success?: boolean;
  status?: boolean;
  message: string;
  data?: any;
}

export interface CreateVendorWorkerResponse {
  status: boolean;
  message: string;
  data: {
    VendorWorkerUserId: number;
    VendorId: number;
    UserName: string;
    MobileNumber: string;
    RoleId: number;
    IncomingRoleId: number;
    CreatedByUserId?: number | null;
    CreatedByVendorId?: number | null;
    TotalFiles?: number;
  };
}

export interface ChangeVendorWorkerPasswordRequest {
  VendorWorkerUserId: number;
  NewPassword: string;
  IncomingVendorId: number;
  IncomingRoleId: number;
}

export interface ChangeVendorWorkerPasswordResponse {
  status: boolean;
  message: string;
  data?: {
    VendorWorkerUserId: number;
    UserName?: string;
    UpdatedByVendorId?: number;
    VendorUpdatedAt?: string;
  };
}

export interface VendorWorkerItem {
  VendorWorkerUserId: number;
  VendorId: number;
  UserName: string;
  MobileNumber: string;
  RoleId?: number;
  IsDisabled?: boolean;
  CreatedByUserId?: number | null;
  UpdatedByUserId?: number | null;
  AdminCreatedAt?: string | null;
  AdminUpdatedAt?: string | null;
  CreatedByVendorId?: number | null;
  UpdatedByVendorId?: number | null;
  VendorCreatedAt?: string | null;
  VendorUpdatedAt?: string | null;
  createdAt?: number;
  aadharCardUri?: string;
  panCardUri?: string;
  photoUri?: string;
}

export interface FetchVendorWorkersResponse {
  status: boolean;
  message: string;
  data: VendorWorkerItem[];
}

export interface EditVendorWorkerRequest {
  flagId: number;
  VendorWorkerUserId: number;
  VendorId: number;
  UserName: string;
  MobileNumber: string;
}

export interface EditVendorWorkerResponse {
  status: boolean;
  message: string;
  data: VendorWorkerItem;
}

// Substation Assignment to Workers Types
export interface WorkerDropdownItem {
  WorkerId: number;
  WorkerName: string;
}

export interface SubstationDropdownItem {
  VendorAssignmentId: number;
  VendorStationAssignmentId: number;
  ExcelDataId: number;
  StationName: string;
  VendorId: number;
  VendorAssignmentStatusId?: number;
  VendorStationStatusId?: number;
}

export interface FetchAssignWorkerDpdwnResponse<T> {
  status: boolean;
  message: string;
  count: number;
  result: T[];
}

export interface InsertWorkerAssignmentRequest {
  flagId: number;
  VendorId: number;
  VendorAssignmentId: number;
  WorkerId: number;
  ExcelDataIds: number[];
  CreatedByUserName: string;
}

export interface InsertWorkerAssignmentResponse {
  status: boolean;
  message: string;
  data?: any;
  result?: any;
}

export interface SingleStationWorkerDropdownItem {
  WorkerId: number;
  WorkerName: string;
}

export interface FetchSingleStationWorkerDropdownResponse {
  status: boolean;
  message: string;
  data: SingleStationWorkerDropdownItem[];
}

export interface InsertAssignToWorkerRequest {
  flagId: number;
  WorkerId: number;
  VendorId: number;
  vendorAssignmentId: number;
  ExcelDataId: number;
  CreatedByUserName: string;
}

export interface InsertAssignToWorkerResponse {
  status: boolean;
  message: string;
  data?: {
    WorkerStationAssignmentId: number;
    VendorAssignmentId: number;
    VendorId: number;
    WorkerId: number;
    ExcelDataId: number;
    StatusId: number;
    IsDisabled: boolean;
    CreatedAt: string;
    UpdatedAt?: string | null;
    CreatedByUserName?: string | null;
    UpdatedByUserName?: string | null;
  };
}

export interface VendorWorkerStationAssignmentItem {
  WorkerStationAssignmentId: number;
  VendorAssignmentId: number;
  VendorId: number;
  WorkerId: number;
  WorkerName: string;
  WorkerMobileNumber: string;
  WorkerRoleId?: number | null;
  VendorName: string;
  CompanyName: string;
  ExcelDataId: number;
  StationName: string;
  Taluk?: string;
  VoltageClass?: string;
  InChangreAEJEname?: string;
  StationContactNumber?: string;
  SubStationAddress?: string;
  PinCode?: string;
  Latitude?: string;
  Longitude?: string;
  Zone?: string;
  Circle?: string;
  Division?: string;
  StatusId?: number;
  AssignmentIsDisabled?: boolean;
  CreatedAt?: string;
  UpdatedAt?: string;
  CreatedByUserName?: string;
  UpdatedByUserName?: string | null;
}

export interface FetchVendorAssignWorkerDetailsResponse {
  status: boolean;
  message: string;
  count: number;
  result: VendorWorkerStationAssignmentItem[];
}

export interface WorkerPendingStationItem {
  WorkerStationAssignmentId: number;
  VendorAssignmentId: number;
  VendorId: number;
  WorkerId: number;
  ExcelDataId: number;
  StatusId: number;
  AssignmentIsDisabled: boolean;
  AssignmentCreatedAt: string;
  AssignmentUpdatedAt: string;
  CreatedByUserName: string;
  UpdatedByUserName: string | null;
  Taluk: string;
  Station: string;
  VoltageClass: string;
  InChangreAEJEname: string;
  StationContactNumber: string;
  SubStationAddress: string;
  PinCode: string;
  Latitude: string;
  Longitude: string;
  Zone: string;
  Circle: string;
  Division: string;
  'Customer State'?: string;
  WorkerName: string;
  WorkerMobileNumber: string;
  WorkerRoleId?: number | null;
  WorkerIsDisabled?: boolean;
  VendorName: string;
  CompanyName: string;
  VendorContactPerson?: string;
  VendorContactNumber?: string;
  VendorEmailAddress?: string | null;
  GSTNumber?: string | null;
  VendorAddress?: string | null;
  VendorCity?: string | null;
  VendorState?: string | null;
  VendorRoleId?: number;
  SwitchSerialNumber: string;
  ResilientSerialNumber: string;
  InstallationSubmissionId?: number;
  SwitchFirmWareNumber?: string;
  InstallationStatusId?: number;
  InstallationCreatedAt?: string;
  InstallationUpdatedAt?: string;
  InstallationCreatedByUserName?: string;
  InstallationUpdatedByUserName?: string;
  InstallationRemarks?: string;
  InstallationVendorId?: number;
  files?: CompletedStationFile[];
  PendingFileTypeIds?: VendorFileType[];
  PendingFileTypes?: VendorFileType[];
  VendorStatusName?: string;
  InstallationSubmissionStatusName?: string | null;
}

export type WorkerCompletedStationItem = WorkerPendingStationItem;

export interface FetchPendingWorkerListResponse {
  status: boolean;
  message: string;
  count: number;
  result: WorkerPendingStationItem[];
}

export interface WorkerInstallationViewRequest {
  flagId: number;
  InstallationSubmissionFileId: number;
}

export interface FetchWorkerInsertDropdownResponse {
  status: boolean;
  message: string;
  count: number;
  result: VendorFileType[];
}

export interface InsertWorkerStationSubmissionResponse {
  status: boolean;
  message: string;
  data?: {
    InstallationSubmissionId: number;
    HistoryResilientNoId: number;
    StationSubmissionId: number;
    WorkerStationAssignmentId: number;
    VendorStationAssignmentId: number;
    VendorAssignmentId: number;
    RouteStationStatusId: number;
    UploadedFileCount: number;
    TotalStations: number;
    CompletedStations: number;
    VendorAssignmentCompleted: boolean;
  };
}
