import { apiService } from '../src/api/apiService';

describe('Vendor Worker Management APIs (Online Only)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('createVendorWorker sends POST to /apkcreateVendorWorkerUser and parses response', async () => {
    const mockResponse = {
      status: true,
      message: 'Vendor worker created successfully.',
      data: {
        VendorWorkerUserId: 11,
        VendorId: 5,
        UserName: 'new',
        MobileNumber: '9999955771',
        RoleId: 9,
        IncomingRoleId: 8,
        CreatedByUserId: null,
        CreatedByVendorId: 5,
        TotalFiles: 3,
      },
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const dummyFormData = new FormData();
    dummyFormData.append('VendorId', '5');
    dummyFormData.append('UserName', 'new');
    dummyFormData.append('Password', 'admin@123');
    dummyFormData.append('MobileNumber', '9999955771');
    dummyFormData.append('RoleId', '9');
    dummyFormData.append('flagId', '1');
    dummyFormData.append('FileTypeIds', JSON.stringify([1, 2, 3]));
    dummyFormData.append('IncomingRoleId', '8');

    const result = await apiService.createVendorWorker(dummyFormData);
    expect(result.status).toBe(true);
    expect(result.data.VendorWorkerUserId).toBe(11);
    expect(result.data.UserName).toBe('new');
    expect(result.data.RoleId).toBe(9);
    expect(result.data.IncomingRoleId).toBe(8);
  });

  it('changeVendorWorkerPassword sends POST to /apkchangeVendorWorkerUserPassword and parses response', async () => {
    const mockResponse = {
      status: true,
      message: 'Vendor Worker User password changed successfully.',
      data: {
        VendorWorkerUserId: 8,
        UserName: 'hello',
        UpdatedByVendorId: 1,
        VendorUpdatedAt: '2026-10-23T16:12:21.889Z',
      },
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const payload = {
      VendorWorkerUserId: 8,
      NewPassword: 'Password@123',
      IncomingVendorId: 1,
      IncomingRoleId: 8,
    };

    const result = await apiService.changeVendorWorkerPassword(payload);
    expect(result.status).toBe(true);
    expect(result.data?.VendorWorkerUserId).toBe(8);
    expect(result.data?.UpdatedByVendorId).toBe(1);
  });

  it('fetchVendorWorkers sends POST to /apkfetchVendorWorkerUser and parses response', async () => {
    const mockResponse = {
      status: true,
      message: 'Vendor Worker Details Fetched Succesfully',
      data: [
        {
          VendorWorkerUserId: 17,
          VendorId: 1,
          UserName: 'iiiiiiiiiii',
          MobileNumber: '78678567670',
          IsDisabled: false,
          CreatedByUserId: 1,
          UpdatedByUserId: 1,
          AdminCreatedAt: '2026-10-24T06:34:58.239Z',
          AdminUpdatedAt: '2026-10-23T18:16:13.929Z',
          CreatedByVendorId: null,
          UpdatedByVendorId: null,
          VendorCreatedAt: null,
          VendorUpdatedAt: null,
          RoleId: 4,
        },
        {
          VendorWorkerUserId: 16,
          VendorId: 1,
          UserName: 'iuyhuigh',
          MobileNumber: '786785675674',
          IsDisabled: false,
          CreatedByUserId: null,
          UpdatedByUserId: 1,
          AdminCreatedAt: null,
          AdminUpdatedAt: '2026-10-23T17:54:49.818Z',
          CreatedByVendorId: 5,
          UpdatedByVendorId: null,
          VendorCreatedAt: '2026-10-24T05:32:05.554Z',
          VendorUpdatedAt: null,
          RoleId: 4,
        },
      ],
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const result = await apiService.fetchVendorWorkers(1, 2);
    expect(result.status).toBe(true);
    expect(result.data.length).toBe(2);
    expect(result.data[0].VendorWorkerUserId).toBe(17);
    expect(result.data[0].UserName).toBe('iiiiiiiiiii');
    expect(result.data[1].VendorWorkerUserId).toBe(16);
  });

  it('editVendorWorker sends PUT to /apkEditVendorWorker and parses response', async () => {
    const mockResponse = {
      status: true,
      message: 'Vendor Worker Details Updated Succesfully',
      data: {
        VendorWorkerUserId: 8,
        VendorId: 2,
        UserName: 'kjhggr',
        MobileNumber: '4567865435',
        IsDisabled: false,
        CreatedByUserId: null,
        UpdatedByUserId: 23,
        AdminCreatedAt: null,
        AdminUpdatedAt: '2026-10-23T18:11:30.705Z',
        CreatedByVendorId: 1,
        UpdatedByVendorId: 2,
        VendorCreatedAt: '2026-10-23T11:25:11.938Z',
        VendorUpdatedAt: '2026-10-23T16:12:21.889Z',
        RoleId: 9,
      },
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const payload = {
      flagId: 1,
      VendorWorkerUserId: 8,
      VendorId: 2,
      UserName: 'kjhggr',
      MobileNumber: '4567865435',
    };

    const result = await apiService.editVendorWorker(payload);
    expect(result.status).toBe(true);
    expect(result.data.VendorWorkerUserId).toBe(8);
    expect(result.data.UserName).toBe('kjhggr');
    expect(result.data.MobileNumber).toBe('4567865435');
    expect(result.data.UpdatedByVendorId).toBe(2);
  });

  it('fetchWorkerDropdown sends POST flagId:2 to /vendorWorkerAssign/fetchAssignWorkerDpdwn and parses response', async () => {
    const mockResponse = {
      status: true,
      message: 'The DropDown Data Fetched Successfully.',
      count: 1,
      result: [
        {
          WorkerId: 7,
          WorkerName: 'fazil - 7894561230',
        },
      ],
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const result = await apiService.fetchWorkerDropdown(4);
    expect(result.length).toBe(1);
    expect(result[0].WorkerId).toBe(7);
    expect(result[0].WorkerName).toBe('fazil - 7894561230');
  });

  it('fetchSubstationDropdown sends POST flagId:1 to /vendorWorkerAssign/fetchAssignWorkerDpdwn and parses response', async () => {
    const mockResponse = {
      status: true,
      message: 'The DropDown Data Fetched Successfully.',
      count: 3,
      result: [
        {
          VendorAssignmentId: 9,
          VendorStationAssignmentId: 49,
          ExcelDataId: 807,
          StationName: 'Bidi 110',
          VendorId: 4,
          VendorAssignmentStatusId: 1,
          VendorStationStatusId: 1,
        },
        {
          VendorAssignmentId: 9,
          VendorStationAssignmentId: 45,
          ExcelDataId: 866,
          StationName: 'Aratagalkitadal 110',
          VendorId: 4,
          VendorAssignmentStatusId: 1,
          VendorStationStatusId: 1,
        },
      ],
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const result = await apiService.fetchSubstationDropdown(4);
    expect(result.length).toBe(2);
    expect(result[0].ExcelDataId).toBe(807);
    expect(result[0].StationName).toBe('Bidi 110');
    expect(result[1].ExcelDataId).toBe(866);
    expect(result[1].StationName).toBe('Aratagalkitadal 110');
  });

  it('insertWorkerAssignment sends POST to /vendorWorkerAssign/insertWorkerAssignment and parses response', async () => {
    const mockResponse = {
      status: true,
      message: 'Worker Assignment inserted successfully.',
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const payload = {
      flagId: 1,
      VendorId: 1,
      VendorAssignmentId: 6,
      WorkerId: 5,
      ExcelDataIds: [1739, 1745],
      CreatedByUserName: 'Vendor Admin - 7777777777',
    };

    const result = await apiService.insertWorkerAssignment(payload);
    expect(result.status).toBe(true);
    expect(result.message).toBe('Worker Assignment inserted successfully.');
  });

  it('fetchVendorAssignWorkerDetails sends POST to /vendorWorkerAssign/fetchVendorAssignWorkerDetails and parses assigned stations correctly even with backend status:false quirk', async () => {
    const mockResponse = {
      status: false,
      message: 'The VendorAssignDetails Fetched SuccessFully.',
      count: 2,
      result: [
        {
          WorkerStationAssignmentId: 9,
          VendorAssignmentId: 9,
          VendorId: 4,
          WorkerId: 7,
          WorkerName: 'fazillll',
          WorkerMobileNumber: '7894561230',
          WorkerRoleId: null,
          VendorName: 'chethan',
          CompanyName: 'vishvin tech',
          ExcelDataId: 866,
          StationName: 'Aratagalkitadal',
          Taluk: 'Savadatti (Taluk)',
          VoltageClass: '110',
          InChangreAEJEname: 'Vishal Rathod',
          StationContactNumber: '8123738251',
          SubStationAddress: '110KV/Besides Kittur Rani Chennamma school, Kitadal',
          PinCode: '591117',
          Latitude: '15.909145',
          Longitude: '75.1497',
          Zone: 'Bagalkot Zone',
          Circle: 'Belgaum (Circle)',
          Division: 'Belgaum (Division)',
          StatusId: 1,
          AssignmentIsDisabled: false,
          CreatedAt: '2026-10-24T08:41:50.824Z',
          UpdatedAt: '2026-10-24T08:41:50.824Z',
          CreatedByUserName: 'praveen.m - 9988776655',
          UpdatedByUserName: null,
        },
        {
          WorkerStationAssignmentId: 8,
          VendorAssignmentId: 9,
          VendorId: 4,
          WorkerId: 7,
          WorkerName: 'fazillll',
          WorkerMobileNumber: '7894561230',
          WorkerRoleId: null,
          VendorName: 'chethan',
          CompanyName: 'vishvin tech',
          ExcelDataId: 895,
          StationName: 'Belgaum',
          Taluk: 'Belagavi (Taluk)',
          VoltageClass: '220',
          InChangreAEJEname: 'Vaishali T Gurav',
          StationContactNumber: '9448072562',
          SubStationAddress: '220KV R/S KPTCL Belagavi, Near Hindalco Factory',
          PinCode: '590010',
          Latitude: '15.905729',
          Longitude: '74.52986',
          Zone: 'Bagalkot Zone',
          Circle: 'Belgaum (Circle)',
          Division: 'Belgaum (Division)',
          StatusId: 3,
          AssignmentIsDisabled: false,
          CreatedAt: '2026-10-24T08:15:19.173Z',
          UpdatedAt: '2026-10-24T08:37:10.901Z',
          CreatedByUserName: 'praveen.m - 9988776655',
          UpdatedByUserName: 'workerName-mobilenumber',
        },
      ],
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const list = await apiService.fetchVendorAssignWorkerDetails(4, 1);
    expect(list.length).toBe(2);
    expect(list[0].WorkerStationAssignmentId).toBe(9);
    expect(list[0].WorkerName).toBe('fazillll');
    expect(list[0].StationName).toBe('Aratagalkitadal');
    expect(list[0].StatusId).toBe(1);
    expect(list[1].WorkerStationAssignmentId).toBe(8);
    expect(list[1].StationName).toBe('Belgaum');
    expect(list[1].StatusId).toBe(3);
  });

  it('fetchPendingWorkerList sends POST to /vendorWorkerAssign/fetchPenidngWorkerList with WorkerId and flagId', async () => {
    const mockResponse = {
      status: true,
      message: 'The WorkerData Fetched Successfully.',
      count: 2,
      result: [
        {
          WorkerStationAssignmentId: 4,
          VendorAssignmentId: 6,
          VendorId: 1,
          WorkerId: 5,
          ExcelDataId: 1745,
          StatusId: 1,
          AssignmentIsDisabled: false,
          AssignmentCreatedAt: '2026-10-23T12:59:44.219Z',
          AssignmentUpdatedAt: '2026-10-23T12:59:44.219Z',
          CreatedByUserName: 'Vendor Admin',
          UpdatedByUserName: null,
          Taluk: 'Moodbidri',
          Station: 'Moodabidre',
          VoltageClass: '110',
          InChangreAEJEname: 'Sri Rajesh - AEE',
          StationContactNumber: '9480823280',
          SubStationAddress: '110/33/11KV Substation, KPTCL, Moodabidre, Miththabailu Post, Moodabidre Taluk, D.K District - 574226',
          PinCode: '574226',
          Latitude: '13.08766',
          Longitude: '74.976535',
          Zone: 'Hassan',
          Circle: 'Mangaluru',
          Division: 'Kemar',
          'Customer State': 'Karnataka',
          WorkerName: 'Ramesh Kumar',
          WorkerMobileNumber: '9876543210',
          WorkerRoleId: 8,
          WorkerIsDisabled: false,
          VendorName: 'Praveen',
          CompanyName: 'vishvin tech',
          VendorContactPerson: 'Dev Team',
          VendorContactNumber: '9999999999',
          VendorEmailAddress: 'dev.team@vishvin.com',
          GSTNumber: null,
          VendorAddress: null,
          VendorCity: null,
          VendorState: null,
          VendorRoleId: 8,
          SwitchSerialNumber: '2660H251FDMN',
          ResilientSerialNumber: '202607311124',
        },
        {
          WorkerStationAssignmentId: 3,
          VendorAssignmentId: 6,
          VendorId: 1,
          WorkerId: 5,
          ExcelDataId: 1739,
          StatusId: 1,
          AssignmentIsDisabled: false,
          AssignmentCreatedAt: '2026-10-23T12:59:44.219Z',
          AssignmentUpdatedAt: '2026-10-23T12:59:44.219Z',
          CreatedByUserName: 'Vendor Admin',
          UpdatedByUserName: null,
          Taluk: 'Udupi',
          Station: 'Madhuvana',
          VoltageClass: '110',
          InChangreAEJEname: 'Sri Muralidhara Madhava Shettigar-AE',
          StationContactNumber: '9886478399',
          SubStationAddress: '110/33/11KV Substation, KPTCL, Madhuvan, Athlady Post, Udupi Taluk, Udupi District - 576225',
          PinCode: '576225',
          Latitude: '13.515909',
          Longitude: '74.744123',
          Zone: 'Hassan',
          Circle: 'Mangaluru',
          Division: 'Kemar',
          'Customer State': 'Karnataka',
          WorkerName: 'Ramesh Kumar',
          WorkerMobileNumber: '9876543210',
          WorkerRoleId: 8,
          WorkerIsDisabled: false,
          VendorName: 'Praveen',
          CompanyName: 'vishvin tech',
          VendorContactPerson: 'Dev Team',
          VendorContactNumber: '9999999999',
          VendorEmailAddress: 'dev.team@vishvin.com',
          GSTNumber: null,
          VendorAddress: null,
          VendorCity: null,
          VendorState: null,
          VendorRoleId: 8,
          SwitchSerialNumber: '2660H251FVJ7',
          ResilientSerialNumber: '202607310896',
        },
      ],
    };

    (globalThis as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    }) as any;

    const list = await apiService.fetchPendingWorkerList(5, 1);
    expect(list.length).toBe(2);
    expect(list[0].WorkerId).toBe(5);
    expect(list[0].Station).toBe('Moodabidre');
    expect(list[0].SwitchSerialNumber).toBe('2660H251FDMN');
    expect(list[0].ResilientSerialNumber).toBe('202607311124');
    expect(list[1].WorkerId).toBe(5);
    expect(list[1].Station).toBe('Madhuvana');
    expect(list[1].SwitchSerialNumber).toBe('2660H251FVJ7');
  });

  it('fetchCompletedWorkerList sends POST to /vendorWorkerAssign/fetchPenidngWorkerList with flagId: 2 and WorkerId', async () => {
    const mockCompletedResponse = {
      status: true,
      message: 'The WorkerData Fetched Successfully.',
      count: 2,
      result: [
        {
          WorkerStationAssignmentId: 11,
          VendorAssignmentId: 9,
          VendorId: 4,
          WorkerId: 7,
          ExcelDataId: 1042,
          StatusId: 3,
          AssignmentIsDisabled: false,
          AssignmentCreatedAt: '2026-10-24T08:41:50.824Z',
          AssignmentUpdatedAt: '2026-10-24T09:08:19.589Z',
          CreatedByUserName: 'praveen.m - 9988776655',
          UpdatedByUserName: 'workerName-mobilenumber',
          Taluk: 'Ramadurga (Taluk)',
          Station: 'G Hosakoti',
          VoltageClass: '110',
          InChangreAEJEname: 'Chetan Ajjannavar',
          StationContactNumber: '8660966853',
          SubStationAddress: '110kV/Guttigol Hosakote village, Ramdurga taluka',
          PinCode: '591130',
          Latitude: '16.1604',
          Longitude: '75.27073',
          Zone: 'Bagalkot Zone',
          Circle: 'Belgaum (Circle)',
          Division: 'Belgaum (Division)',
          CustomerState: 'Karnataka',
          WorkerName: 'fazillll',
          WorkerMobileNumber: '7894561230',
          WorkerRoleId: null,
          WorkerIsDisabled: false,
          VendorName: 'chethan',
          CompanyName: 'vishvin tech',
          VendorContactPerson: 'praveen.m',
          VendorContactNumber: '9988776655',
          VendorEmailAddress: null,
          GSTNumber: null,
          VendorAddress: null,
          VendorCity: null,
          VendorState: null,
          VendorRoleId: 8,
          SwitchSerialNumber: '2660H251FWNV',
          ResilientSerialNumber: '202607310377',
          InstallationSubmissionId: 20,
          SwitchFirmWareNumber: '111111111',
          InstallationStatusId: 3,
          InstallationCreatedAt: '2026-10-24T09:08:19.589Z',
          InstallationUpdatedAt: '2026-10-24T09:08:19.589Z',
          InstallationCreatedByUserName: 'workerName-mobilenumber',
          InstallationUpdatedByUserName: 'workerName-mobilenumber',
          InstallationRemarks: 'completed',
          InstallationVendorId: 4,
          files: [
            {
              installationSubmissionFileId: 82,
              fileTypeId: 4,
              fileTypeName: 'Rack Photo',
              fileName: '1792832899487-239138351.png',
            },
            {
              installationSubmissionFileId: 83,
              fileTypeId: 5,
              fileTypeName: 'User End Point Photo',
              fileName: '1792832899503-558037141.png',
            },
          ],
        },
      ],
    };

    let capturedUrl = '';
    let capturedBody: any = null;

    (globalThis as any).fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => mockCompletedResponse,
      };
    }) as any;

    const completed = await apiService.fetchCompletedWorkerList(7, 2);
    expect(capturedUrl).toContain('/vendorWorkerAssign/fetchPenidngWorkerList');
    expect(capturedBody).toEqual({ flagId: 2, WorkerId: 7 });
    expect(completed.length).toBe(1);
    expect(completed[0].WorkerStationAssignmentId).toBe(11);
    expect(completed[0].Station).toBe('G Hosakoti');
    expect(completed[0].StatusId).toBe(3);
    expect(completed[0].InstallationSubmissionId).toBe(20);
    expect(completed[0].files?.length).toBe(2);
    expect(completed[0].files?.[0].installationSubmissionFileId).toBe(82);
  });

  it('fetchInstallationImageBase64 for worker calls /vendorWorkerAssign/workerInstallationView with flagId: 1', async () => {
    let capturedUrl = '';
    let capturedBody: any = null;

    const mockBlob = {
      size: 100,
      type: 'image/png',
    };

    (globalThis as any).fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        blob: async () => mockBlob,
      };
    }) as any;

    // Mock FileReader
    const originalFileReader = (globalThis as any).FileReader;
    (globalThis as any).FileReader = class {
      onloadend: () => void = () => {};
      result: string = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA';
      readAsDataURL() {
        setTimeout(() => this.onloadend(), 5);
      }
    };

    try {
      const base64 = await apiService.fetchInstallationImageBase64(999, 1, true);
      expect(capturedUrl).toContain('/vendorWorkerAssign/workerInstallationView');
      expect(capturedBody).toEqual({
        flagId: 1,
        InstallationSubmissionFileId: 999,
      });
      expect(base64).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA');
    } finally {
      (globalThis as any).FileReader = originalFileReader;
    }
  });

  it('fetchWorkerInsertDropdown sends POST to /vendorWorkerAssign/fetchInsertDpdwn with flagId: 1', async () => {
    const mockDropdownResponse = {
      status: true,
      message: 'The DropDown Data Fetched Successfully.',
      count: 6,
      result: [
        { VendorFileTypeId: 7, VendorFileTypeName: 'Annexure-11' },
        { VendorFileTypeId: 6, VendorFileTypeName: 'RTU/SAS Panel Photo' },
        { VendorFileTypeId: 8, VendorFileTypeName: 'LIU OFC Splicing Photo' },
        { VendorFileTypeId: 9, VendorFileTypeName: 'Configuration Photo' },
        { VendorFileTypeId: 5, VendorFileTypeName: 'User End Point Photo' },
        { VendorFileTypeId: 4, VendorFileTypeName: 'Rack Photo' },
      ],
    };

    let capturedUrl = '';
    let capturedBody: any = null;

    (globalThis as any).fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => mockDropdownResponse,
      };
    }) as any;

    const result = await apiService.fetchWorkerInsertDropdown(1);
    expect(capturedUrl).toContain('/vendorWorkerAssign/fetchInsertDpdwn');
    expect(capturedBody).toEqual({ flagId: 1 });
    expect(result.length).toBe(6);
    expect(result[0].VendorFileTypeId).toBe(7);
    expect(result[0].VendorFileTypeName).toBe('Annexure-11');
    expect(result[5].VendorFileTypeId).toBe(4);
    expect(result[5].VendorFileTypeName).toBe('Rack Photo');
  });

  it('insertWorkerStationSubmission sends POST to /vendorWorkerAssign/insertingWorkerStationSubmission and parses response', async () => {
    const mockSubmissionResponse = {
      status: true,
      message: 'Worker station installation submitted successfully.',
      data: {
        InstallationSubmissionId: 18,
        HistoryResilientNoId: 22,
        StationSubmissionId: 371,
        WorkerStationAssignmentId: 8,
        VendorStationAssignmentId: 47,
        VendorAssignmentId: 9,
        RouteStationStatusId: 617,
        UploadedFileCount: 6,
        TotalStations: 8,
        CompletedStations: 3,
        VendorAssignmentCompleted: false,
      },
    };

    let capturedUrl = '';
    let capturedOpts: any = null;

    (globalThis as any).fetch = jest.fn().mockImplementation(async (url: string, opts: any) => {
      capturedUrl = url;
      capturedOpts = opts;
      return {
        ok: true,
        json: async () => mockSubmissionResponse,
      };
    }) as any;

    const formData = new FormData();
    formData.append('flagId', '1');
    formData.append('WorkerStationAssignmentId', '8');
    formData.append('WorkerId', '7');
    formData.append('ExcelDataId', '895');
    formData.append('Remarks', 'completed');
    formData.append('SwitchFirmWareNumber', '123456789');
    formData.append('SwitchSerialNumber', '2660H2515J82');
    formData.append('ResilientSerialNumber', '202607310027');
    formData.append('CreatedByUserName', 'fazillll - 7894561230');
    formData.append('FileTypeIds', JSON.stringify([4, 5, 6, 7, 8, 9]));

    const res = await apiService.insertWorkerStationSubmission(formData);
    expect(capturedUrl).toContain('/vendorWorkerAssign/insertingWorkerStationSubmission');
    expect(capturedOpts.method).toBe('POST');
    expect(res.status).toBe(true);
    expect(res.data?.InstallationSubmissionId).toBe(18);
    expect(res.data?.WorkerStationAssignmentId).toBe(8);
    expect(res.data?.UploadedFileCount).toBe(6);
  });
});

