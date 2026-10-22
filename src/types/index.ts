export interface LoginRequest {
  contactNumber: string;
  password: string;
}

export interface VendorProfile {
  VendorId: number;
  VendorName: string;
  CompanyName: string;
  ContactPerson: string;
  ContactNumber: string;
  EmailAddress: string;
  GSTNumber: string;
  Address: string;
  City: string;
  State: string;
  Remarks: string;
  IsDisabled: boolean;
  CreatedAt: string;
  UpdatedAt: string;
  CreatedByUserName: string;
  UpdatedByUserName: string | null;
}

export interface LoginResponse {
  status: boolean;
  message: string;
  userType: string;
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



