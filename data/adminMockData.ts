// This file centralizes mock data for the admin portal features.

// --- RBAC DATA ---
export type Role = 'Super Admin' | 'Ops Manager' | 'Finance' | 'Support';

export interface AdminUser {
    id: string;
    name: string;
    email: string;
    role: Role;
}

export const adminUsers: AdminUser[] = [
    { id: 'USER-001', name: 'Admin User', email: 'admin@cleannami.com', role: 'Super Admin' },
    { id: 'USER-002', name: 'Olivia Vance', email: 'ops@cleannami.com', role: 'Ops Manager' },
    { id: 'USER-003', name: 'Ben Carter', email: 'finance@cleannami.com', role: 'Finance' },
    { id: 'USER-004', name: 'Casey Day', email: 'support@cleannami.com', role: 'Support' },
];

export const PERMISSIONS = {
    'Super Admin': ['Dashboard', 'Cleaner Mgmt', 'Job Oversight', 'Customer Mgmt', 'Properties', 'Subscriptions', 'Financials', 'Disputes', 'Reporting', 'Notifications', 'Settings & Security'],
    'Ops Manager': ['Dashboard', 'Cleaner Mgmt', 'Job Oversight', 'Properties', 'Disputes', 'Reporting', 'Notifications'],
    'Finance': ['Dashboard', 'Subscriptions', 'Financials', 'Reporting'],
    'Support': ['Dashboard', 'Job Oversight', 'Customer Mgmt', 'Properties', 'Disputes', 'Notifications'],
};


// --- OWNER DATA ---
export interface Owner {
    id: string;
    name: string;
}

export const owners: Owner[] = [
    { id: 'OWNER-01', name: 'John Davis' },
    { id: 'OWNER-02', name: 'Sarah Miller' },
    { id: 'OWNER-03', name: 'Kevin Lee' },
];


// --- CLEANER DATA ---
export interface DocumentInfo {
    status: 'Complete' | 'Pending' | 'Missing';
    fileName?: string;
    fileUrl?: string; // Mock URL for demonstration
}

export interface Cleaner {
    id: string;
    name: string;
    email: string;
    phone: string;
    experienceLevel: 'Beginner' | 'Intermediate' | 'Expert';
    distancePreference: number; // in miles
    reliability: number; // This will be dynamically calculated
    status: 'Active' | 'Suspended';
    tags: ('Hot-tub capable' | 'Laundry lead')[];
    flags: string[];
    basePay: number;
    expectedHours: number;
    documents: {
      w9: DocumentInfo;
      waiver: DocumentInfo;
      gpsConsent: DocumentInfo;
    };
    performance: { // This will be dynamically calculated
      availabilityHistory: string;
      raiseEligible: boolean;
      badges: string[];
    };
}
  
export const cleaners: Cleaner[] = [
    { 
      id: 'CLN-001', name: 'Maria Garcia', email: 'maria.g@email.com', phone: '555-0101', experienceLevel: 'Expert', distancePreference: 20, reliability: 99.2, status: 'Active', tags: ['Hot-tub capable', 'Laundry lead'], flags: [], basePay: 35, expectedHours: 3,
      documents: { 
          w9: { status: 'Complete', fileName: 'w9_maria_garcia.pdf', fileUrl: '#' }, 
          waiver: { status: 'Complete', fileName: 'waiver_signed_mg.pdf', fileUrl: '#' }, 
          gpsConsent: { status: 'Complete', fileName: 'gps_consent_mg.pdf', fileUrl: '#' } 
      },
      performance: { availabilityHistory: '95% in last 30 days', raiseEligible: true, badges: ['Top Performer Q2'] }
    },
    { 
      id: 'CLN-002', name: 'David Smith', email: 'd.smith@email.com', phone: '555-0102', experienceLevel: 'Intermediate', distancePreference: 15, reliability: 97.8, status: 'Active', tags: ['Hot-tub capable'], flags: [], basePay: 30, expectedHours: 4,
      documents: { 
          w9: { status: 'Complete', fileName: 'w9_dsmith_2023.pdf', fileUrl: '#' }, 
          waiver: { status: 'Complete', fileName: 'liability_waiver_ds.pdf', fileUrl: '#' }, 
          gpsConsent: { status: 'Pending' } 
      },
      performance: { availabilityHistory: '98% in last 30 days', raiseEligible: false, badges: [] }
    },
    { 
      id: 'CLN-003', name: 'Chen Wei', email: 'chen.wei@email.com', phone: '555-0103', experienceLevel: 'Beginner', distancePreference: 10, reliability: 85.1, status: 'Active', tags: [], flags: ['Low reliability', '1 Late Arrival'], basePay: 25, expectedHours: 3.5,
      documents: { 
          w9: { status: 'Complete', fileName: 'chen_w9_form.pdf', fileUrl: '#' }, 
          waiver: { status: 'Pending' }, 
          gpsConsent: { status: 'Complete', fileName: 'gps_form_cw.pdf', fileUrl: '#' } 
      },
      performance: { availabilityHistory: '70% in last 30 days', raiseEligible: false, badges: [] }
    },
    { 
      id: 'CLN-004', name: 'Fatima Al-Sayed', email: 'fatima.a@email.com', phone: '555-0104', experienceLevel: 'Intermediate', distancePreference: 25, reliability: 92.5, status: 'Suspended', tags: ['Hot-tub capable'], flags: ['Missed check-out', 'Banned'], basePay: 28, expectedHours: 4,
      documents: { 
          w9: { status: 'Missing' }, 
          waiver: { status: 'Missing' }, 
          gpsConsent: { status: 'Missing' } 
      },
      performance: { availabilityHistory: '88% in last 30 days', raiseEligible: false, badges: [] }
    },
    { 
      id: 'CLN-005', name: 'John Miller', email: 'j.miller@email.com', phone: '555-0105', experienceLevel: 'Expert', distancePreference: 15, reliability: 98.0, status: 'Active', tags: [], flags: [], basePay: 32, expectedHours: 3,
      documents: { 
          w9: { status: 'Complete', fileName: 'jmiller_w9.pdf', fileUrl: '#' }, 
          waiver: { status: 'Complete', fileName: 'jmiller_waiver.pdf', fileUrl: '#' }, 
          gpsConsent: { status: 'Complete', fileName: 'jmiller_gps.pdf', fileUrl: '#' } 
      },
      performance: { availabilityHistory: '96% in last 30 days', raiseEligible: true, badges: ['5-Star Rated'] }
    },
];

// --- PROPERTY DATA ---
export interface ChecklistVersion {
    version: number;
    uploadDate: string;
    fileName: string;
    active: boolean;
}

export interface ServiceSettings {
    hasHotTub: boolean;
    hotTubService: 'none' | 'basic' | 'full_drain';
    hotTubDrainCadence: '4_weeks' | '6_weeks' | '2_months' | '3_months' | '4_months';
    laundryType: 'in_unit' | 'off_site';
    laundryLoads: number;
}

export interface Property {
    id: string;
    address: string;
    city: string;
    ownerId: string;
    status: 'Active' | 'Pending Jobs' | 'Inactive';
    beds: number;
    baths: number;
    sqft: number;
    serviceSettings: ServiceSettings;
    checklistHistory: ChecklistVersion[];
    iCalUrl: string;
}

export const properties: Property[] = [
    { 
        id: 'PROP-001', address: '123 Ocean Ave', city: 'New Smyrna Beach', ownerId: 'OWNER-01', status: 'Active', beds: 3, baths: 2, sqft: 1800,
        serviceSettings: { hasHotTub: true, hotTubService: 'basic', hotTubDrainCadence: '4_weeks', laundryType: 'in_unit', laundryLoads: 2 },
        checklistHistory: [
            { version: 2, uploadDate: '2024-06-15', fileName: 'OceanAve_Checklist_v2.pdf', active: true },
            { version: 1, uploadDate: '2024-03-01', fileName: 'OceanAve_Checklist_v1.pdf', active: false },
        ],
        iCalUrl: 'https://www.airbnb.com/calendar/ical/123.ics',
    },
    { 
        id: 'PROP-002', address: '789 Salty Air Ct', city: 'New Smyrna Beach', ownerId: 'OWNER-02', status: 'Active', beds: 2, baths: 1, sqft: 1200,
        serviceSettings: { hasHotTub: false, hotTubService: 'none', hotTubDrainCadence: '4_weeks', laundryType: 'off_site', laundryLoads: 3 },
        checklistHistory: [
            { version: 1, uploadDate: '2024-05-20', fileName: 'SaltyAir_Instructions.docx', active: true },
        ],
        iCalUrl: 'https://www.vrbo.com/calendar/ical/456.ics',
    },
    { 
        id: 'PROP-003', address: '456 Beachside Dr', city: 'Daytona Beach', ownerId: 'OWNER-01', status: 'Pending Jobs', beds: 4, baths: 3.5, sqft: 2500,
        serviceSettings: { hasHotTub: true, hotTubService: 'full_drain', hotTubDrainCadence: '6_weeks', laundryType: 'in_unit', laundryLoads: 4 },
        checklistHistory: [
            { version: 1, uploadDate: '2024-07-01', fileName: 'Beachside_v1.pdf', active: true },
        ],
        iCalUrl: '',
    },
    { 
        id: 'PROP-004', address: '101 Coral Reef Rd', city: 'Edgewater', ownerId: 'OWNER-03', status: 'Active', beds: 1, baths: 1, sqft: 800,
        serviceSettings: { hasHotTub: false, hotTubService: 'none', hotTubDrainCadence: '4_weeks', laundryType: 'in_unit', laundryLoads: 1 },
        checklistHistory: [
            { version: 1, uploadDate: '2024-02-10', fileName: 'CoralReef_Checklist.pdf', active: true },
        ],
        iCalUrl: 'https://www.airbnb.com/calendar/ical/789.ics',
    },
    { 
        id: 'PROP-005', address: '212 Sandy Lane', city: 'Daytona Beach', ownerId: 'OWNER-02', status: 'Inactive', beds: 5, baths: 4, sqft: 3200,
        serviceSettings: { hasHotTub: true, hotTubService: 'basic', hotTubDrainCadence: '4_weeks', laundryType: 'off_site', laundryLoads: 5 },
        checklistHistory: [
            { version: 3, uploadDate: '2024-05-05', fileName: 'SandyLane_Summer24.pdf', active: true },
            { version: 2, uploadDate: '2024-01-15', fileName: 'SandyLane_Winter24.pdf', active: false },
            { version: 1, uploadDate: '2023-11-20', fileName: 'SandyLane_Initial.pdf', active: false },
        ],
        iCalUrl: '',
    },
    { 
        id: 'PROP-006', address: '333 Palm Tree Blvd', city: 'New Smyrna Beach', ownerId: 'OWNER-03', status: 'Active', beds: 3, baths: 2, sqft: 1750,
        serviceSettings: { hasHotTub: false, hotTubService: 'none', hotTubDrainCadence: '4_weeks', laundryType: 'in_unit', laundryLoads: 2 },
        checklistHistory: [
            { version: 1, uploadDate: '2024-04-18', fileName: 'PalmTree_Instructions.pdf', active: true },
        ],
        iCalUrl: 'https://www.airbnb.com/calendar/ical/321.ics',
    },
    { 
        id: 'PROP-007', address: '888 Sunshine Way', city: 'Daytona Beach', ownerId: 'OWNER-01', status: 'Active', beds: 2, baths: 2, sqft: 1400,
        serviceSettings: { hasHotTub: true, hotTubService: 'full_drain', hotTubDrainCadence: '2_months', laundryType: 'in_unit', laundryLoads: 2 },
        checklistHistory: [
            { version: 2, uploadDate: '2024-07-10', fileName: 'SunshineWay_v2_updated.pdf', active: true },
            { version: 1, uploadDate: '2024-01-05', fileName: 'SunshineWay_v1.pdf', active: false },
        ],
        iCalUrl: '',
    },
    { 
        id: 'PROP-008', address: '555 Boardwalk Pl', city: 'Edgewater', ownerId: 'OWNER-02', status: 'Pending Jobs', beds: 4, baths: 3, sqft: 2200,
        serviceSettings: { hasHotTub: false, hotTubService: 'none', hotTubDrainCadence: '4_weeks', laundryType: 'off_site', laundryLoads: 4 },
        checklistHistory: [
            { version: 1, uploadDate: '2024-06-01', fileName: 'Boardwalk_Checklist.pdf', active: true },
        ],
        iCalUrl: '',
    },
];


// --- JOB DATA ---
export interface JobFlag {
    id: string;
    reason: string;
    resolved: boolean;
    resolution?: {
        outcome: 'Dispute Denied' | 'Fault: Customer' | 'Fault: Cleaner';
        notes: string;
        refundAmount?: number;
        reliabilityAdjustment?: number;
        resolvedBy: string;
        resolvedAt: string;
    };
}
  
export interface ChecklistItem {
    id: string;
    task: string;
    completed: boolean;
    photoUrl?: string;
}
  
export interface JobHistoryEvent {
    timestamp: string;
    event: string;
}

export type JobStatus = 'Pending' | 'Assigned' | 'In Progress' | 'Awaiting Capture' | 'Paid Out' | 'Canceled';
  
export interface Job {
    id: string;
    propertyId: string;
    cleanerId: string | null;
    status: JobStatus;
    scheduledDateTime: string; // ISO 8601 format
    checkInDateTime: string | null; // ISO 8601 format
    checkOutDateTime: string | null; // ISO 8601 format
    ownerRating: number | null; // 1-5 stars
    flags: JobFlag[];
    checklist: ChecklistItem[];
    history: JobHistoryEvent[];
    basePay: number;
    bonuses: { reason: string; amount: number }[];
    deductions: { reason: string; amount: number }[];
    gpsCoordinates: {
        checkIn: { lat: number, lon: number } | null,
        checkOut: { lat: number, lon: number } | null,
    };
}

// Helper to get a date string for today + offset
const getDate = (hour: number, minute: number, dayOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d.toISOString();
}

export const jobs: Job[] = [
    { 
        id: 'JOB-0231', propertyId: 'PROP-001', cleanerId: 'CLN-001', status: 'In Progress', 
        scheduledDateTime: getDate(15, 0),
        checkInDateTime: getDate(12, 5),
        checkOutDateTime: null,
        ownerRating: null,
        basePay: 150,
        bonuses: [],
        deductions: [],
        gpsCoordinates: { checkIn: { lat: 29.02, lon: -80.90 }, checkOut: null },
        flags: [{ id: 'f-late-1', reason: 'Late start by cleaner (Admin Notified)', resolved: false }],
        checklist: [
            { id: 'c1', task: 'Dust all surfaces in living room and bedrooms.', completed: true, photoUrl: 'https://images.unsplash.com/photo-1585842392147-38a42d921351?q=80&w=800&auto=format&fit=crop' },
            { id: 'c2', task: 'Vacuum all carpets and rugs.', completed: true, photoUrl: 'https://images.unsplash.com/photo-1598214312524-7b02955f1107?q=80&w=800&auto=format&fit=crop' },
            { id: 'c3', task: 'Clean and disinfect all bathroom surfaces (sinks, toilets, showers).', completed: false },
            { id: 'c4', task: 'Stage living room pillows and throws as per guide.', completed: false, photoUrl: 'https://images.unsplash.com/photo-1618220179428-22790b461013?q=80&w=800&auto=format&fit=crop' },
            { id: 'c5', task: 'Restock toiletries (3 rolls of TP, new soap).', completed: true },
        ],
        history: [
            { timestamp: '12:05 PM', event: 'Cleaner checked in.' },
            { timestamp: '11:00 AM', event: 'Cleaner confirmed assignment.' },
            { timestamp: '9:30 AM', event: 'Job assigned to Maria Garcia.' },
            { timestamp: 'Yesterday', event: 'Job created.' },
        ],
    },
    { 
        id: 'JOB-0230', propertyId: 'PROP-002', cleanerId: 'CLN-003', status: 'Assigned', 
        scheduledDateTime: getDate(16, 0),
        checkInDateTime: null, checkOutDateTime: null,
        ownerRating: null,
        basePay: 120,
        bonuses: [],
        deductions: [],
        gpsCoordinates: { checkIn: null, checkOut: null },
        flags: [{ id: 'f1', reason: 'Job not started 15 mins past scheduled time', resolved: false }],
        checklist: [
            { id: 'c1', task: 'Clean kitchen appliances (microwave, coffee maker)', completed: false },
            { id: 'c2', task: 'Make all beds with fresh linens', completed: false },
        ],
        history: [
            { timestamp: '10:00 AM', event: 'Job assigned to Chen Wei.' },
            { timestamp: 'Yesterday', event: 'Job created.' },
        ],
    },
    { 
        id: 'JOB-0229', propertyId: 'PROP-003', cleanerId: 'CLN-002', status: 'Awaiting Capture', 
        scheduledDateTime: getDate(14, 30),
        checkInDateTime: getDate(11, 30),
        checkOutDateTime: getDate(14, 15),
        ownerRating: 5,
        basePay: 200,
        bonuses: [{ reason: 'Hot Tub Service', amount: 25 }],
        deductions: [],
        gpsCoordinates: { checkIn: { lat: 29.21, lon: -81.02 }, checkOut: { lat: 29.21, lon: -81.02 } },
        flags: [],
        checklist: [
            { id: 'c1', task: 'Clean all bedrooms', completed: true, photoUrl: 'https://images.unsplash.com/photo-1595526114035-0d45ed16433d?q=80&w=800&auto=format&fit=crop' },
            { id: 'c2', task: 'Restock toiletries', completed: true },
        ],
        history: [
            { timestamp: '2:15 PM', event: 'Cleaner checked out.' },
            { timestamp: '11:30 AM', event: 'Cleaner checked in.' },
            { timestamp: 'Yesterday', event: 'Job created.' },
        ],
    },
    { 
        id: 'JOB-0228', propertyId: 'PROP-004', cleanerId: null, status: 'Pending', 
        scheduledDateTime: getDate(17, 0),
        checkInDateTime: null, checkOutDateTime: null,
        ownerRating: null,
        basePay: 90,
        bonuses: [{ reason: 'Urgent Booking Bonus', amount: 20 }],
        deductions: [],
        gpsCoordinates: { checkIn: null, checkOut: null },
        flags: [],
        checklist: [],
        history: [{ timestamp: '9:00 AM', event: 'Job created.' }],
    },
    { 
        id: 'JOB-0227', propertyId: 'PROP-005', cleanerId: 'CLN-005', status: 'Paid Out', 
        scheduledDateTime: getDate(12, 0, -1),
        checkInDateTime: getDate(10, 0, -1),
        checkOutDateTime: getDate(13, 30, -1),
        ownerRating: 5,
        basePay: 250,
        bonuses: [],
        deductions: [],
        gpsCoordinates: { checkIn: { lat: 29.20, lon: -81.01 }, checkOut: { lat: 29.20, lon: -81.01 } },
        flags: [],
        checklist: [],
        history: [
            { timestamp: '8:00 AM Today', event: 'Payment processed.' },
            { timestamp: 'Yesterday', event: 'Job completion captured.' },
            { timestamp: 'Yesterday', event: 'Job created.' },
        ],
    },
    { 
        id: 'JOB-0226', propertyId: 'PROP-006', cleanerId: 'CLN-001', status: 'Assigned', 
        scheduledDateTime: getDate(15, 30),
        checkInDateTime: null,
        checkOutDateTime: null,
        ownerRating: null,
        basePay: 175,
        bonuses: [],
        deductions: [],
        gpsCoordinates: { checkIn: null, checkOut: null },
        flags: [],
        checklist: [],
        history: [
            { timestamp: 'Yesterday', event: 'Job assigned to Maria Garcia.' },
            { timestamp: 'Yesterday', event: 'Job created.' },
        ],
    },
    { 
        id: 'JOB-0225', propertyId: 'PROP-008', cleanerId: 'CLN-003', status: 'Paid Out', 
        scheduledDateTime: '2024-07-25T10:00:00Z',
        checkInDateTime: '2024-07-25T10:25:00Z', // LATE CHECK-IN
        checkOutDateTime: '2024-07-25T13:00:00Z',
        ownerRating: 4,
        basePay: 180,
        bonuses: [],
        deductions: [{ reason: 'Late Arrival Penalty', amount: 10 }],
        gpsCoordinates: { checkIn: { lat: 28.93, lon: -80.99 }, checkOut: { lat: 28.93, lon: -80.99 } },
        flags: [],
        checklist: [],
        history: [
            { timestamp: '10:25 AM', event: 'Cleaner checked in.' },
            { timestamp: 'Yesterday', event: 'Job created.' },
        ],
    },
    { 
        id: 'JOB-0224', propertyId: 'PROP-008', cleanerId: 'CLN-003', status: 'Paid Out', 
        scheduledDateTime: '2024-07-26T13:00:00Z',
        checkInDateTime: '2024-07-26T10:00:00Z',
        checkOutDateTime: '2024-07-26T12:45:00Z',
        ownerRating: 3,
        basePay: 180,
        bonuses: [],
        deductions: [],
        gpsCoordinates: { checkIn: { lat: 28.93, lon: -80.99 }, checkOut: { lat: 28.93, lon: -80.99 } },
        flags: [{ 
            id: 'f3', 
            reason: 'Missing checklist/photos', 
            resolved: true,
            resolution: {
                outcome: 'Fault: Cleaner',
                notes: 'Cleaner forgot to upload photos for 3 checklist items. Issued partial refund to customer.',
                refundAmount: 25,
                reliabilityAdjustment: -2,
                resolvedBy: 'Admin User',
                resolvedAt: '2024-07-26T14:10:00Z'
            }
        }],
        checklist: [],
        history: [
            { timestamp: '1:15 PM', event: 'Admin resolved flag: Missing Photos.' },
            { timestamp: '12:45 PM', event: 'Cleaner checked out.' },
            { timestamp: '10:00 AM', event: 'Cleaner checked in.' },
            { timestamp: 'Yesterday', event: 'Job created.' },
        ],
    },
    {
        id: 'JOB-0223', propertyId: 'PROP-007', cleanerId: 'CLN-002', status: 'Canceled',
        scheduledDateTime: getDate(11, 0, -2),
        checkInDateTime: null, checkOutDateTime: null,
        ownerRating: null, basePay: 140, bonuses: [], deductions: [],
        gpsCoordinates: { checkIn: null, checkOut: null },
        flags: [], checklist: [],
        history: [
            { timestamp: 'Yesterday', event: 'Job canceled by admin.' },
            { timestamp: '2 days ago', event: 'Job assigned to David Smith.' },
            { timestamp: '2 days ago', event: 'Job created.' },
        ],
    },
    // --- Added for Financial Reporting ---
    { 
        id: 'JOB-0210', propertyId: 'PROP-007', cleanerId: 'CLN-001', status: 'Paid Out',
        scheduledDateTime: '2024-07-15T14:00:00Z', checkInDateTime: '2024-07-15T13:55:00Z', checkOutDateTime: '2024-07-15T16:30:00Z',
        ownerRating: 5, basePay: 140, bonuses: [], deductions: [], gpsCoordinates: { checkIn: null, checkOut: null }, flags: [], checklist: [], history: []
    },
    { 
        id: 'JOB-0211', propertyId: 'PROP-001', cleanerId: 'CLN-002', status: 'Paid Out',
        scheduledDateTime: '2024-07-10T11:00:00Z', checkInDateTime: '2024-07-10T10:50:00Z', checkOutDateTime: '2024-07-10T14:00:00Z',
        ownerRating: 4, basePay: 150, bonuses: [], deductions: [], gpsCoordinates: { checkIn: null, checkOut: null }, flags: [], checklist: [], history: []
    },
    { 
        id: 'JOB-0201', propertyId: 'PROP-002', cleanerId: 'CLN-003', status: 'Paid Out',
        scheduledDateTime: '2024-06-20T12:00:00Z', checkInDateTime: '2024-06-20T12:10:00Z', checkOutDateTime: '2024-06-20T15:00:00Z',
        ownerRating: 5, basePay: 120, bonuses: [], deductions: [], gpsCoordinates: { checkIn: null, checkOut: null }, flags: [], checklist: [], history: []
    },
    { 
        id: 'JOB-0202', propertyId: 'PROP-006', cleanerId: 'CLN-005', status: 'Paid Out',
        scheduledDateTime: '2024-06-12T15:00:00Z', checkInDateTime: '2024-06-12T14:58:00Z', checkOutDateTime: '2024-06-12T17:30:00Z',
        ownerRating: 5, basePay: 175, bonuses: [], deductions: [], gpsCoordinates: { checkIn: null, checkOut: null }, flags: [], checklist: [], history: []
    },
    { 
        id: 'JOB-0190', propertyId: 'PROP-001', cleanerId: 'CLN-001', status: 'Paid Out',
        scheduledDateTime: '2024-05-25T10:00:00Z', checkInDateTime: '2024-05-25T09:55:00Z', checkOutDateTime: '2024-05-25T12:45:00Z',
        ownerRating: 5, basePay: 150, bonuses: [], deductions: [], gpsCoordinates: { checkIn: null, checkOut: null }, flags: [], checklist: [], history: []
    },
];

// --- SUBSCRIPTION DATA ---
export type SubscriptionStatus = 'Active' | 'Paused' | 'Canceled' | 'Trial';

export interface Subscription {
    id: string;
    propertyId: string;
    status: SubscriptionStatus;
    planName: string;
    pricePerClean: number;
    renewalDate: string;
    autoRenew: boolean;
    prepaid: boolean;
    termMonths: number;
    activityHistory: { date: string; event: string }[];
}

export const subscriptions: Subscription[] = [
    { id: 'SUB-001', propertyId: 'PROP-001', status: 'Active', planName: 'Standard Turnover', pricePerClean: 150, renewalDate: '2024-08-15', autoRenew: true, prepaid: false, termMonths: 6, activityHistory: [
        { date: '2024-07-20', event: 'Auto-renew was enabled.'},
        { date: '2024-02-15', event: 'Subscription started.'}
    ] },
    { id: 'SUB-002', propertyId: 'PROP-002', status: 'Active', planName: 'Standard Turnover', pricePerClean: 120, renewalDate: '2024-09-01', autoRenew: true, prepaid: false, termMonths: 3, activityHistory: [
        { date: '2024-06-01', event: 'Subscription started.'}
    ] },
    { id: 'SUB-003', propertyId: 'PROP-003', status: 'Paused', planName: 'Turnover Plus (Hot Tub)', pricePerClean: 200, renewalDate: '2024-08-20', autoRenew: true, prepaid: true, termMonths: 12, activityHistory: [
        { date: '2024-07-10', event: 'Subscription paused by user.'},
        { date: '2023-08-20', event: 'Subscription started.'}
    ] },
    { id: 'SUB-004', propertyId: 'PROP-004', status: 'Canceled', planName: 'Standard Turnover', pricePerClean: 90, renewalDate: '2024-07-30', autoRenew: false, prepaid: false, termMonths: 1, activityHistory: [
        { date: '2024-06-30', event: 'Subscription canceled by user.'},
        { date: '2024-06-01', event: 'Subscription started.'}
    ] },
    { id: 'SUB-006', propertyId: 'PROP-006', status: 'Active', planName: 'Turnover Plus (Laundry)', pricePerClean: 175, renewalDate: '2024-09-10', autoRenew: false, prepaid: true, termMonths: 6, activityHistory: [
        { date: '2024-03-10', event: 'Subscription started.'}
    ] },
    { id: 'SUB-007', propertyId: 'PROP-007', status: 'Active', planName: 'Standard Turnover', pricePerClean: 140, renewalDate: '2024-08-05', autoRenew: true, prepaid: true, termMonths: 3, activityHistory: [
        { date: '2024-05-05', event: 'Subscription started.'}
    ] },
    { id: 'SUB-008', propertyId: 'PROP-008', status: 'Paused', planName: 'Turnover Plus (Hot Tub)', pricePerClean: 220, renewalDate: '2024-10-01', autoRenew: true, prepaid: false, termMonths: 12, activityHistory: [
        { date: '2024-07-25', event: 'Subscription paused by admin.'},
        { date: '2023-10-01', event: 'Subscription started.'}
    ] },
];

// --- CUSTOMER PAYMENT DATA ---
export interface CustomerPayment {
    id: string;
    jobId: string;
    ownerId: string;
    amount: number;
    paymentDate: string; // ISO 8601
    status: 'Paid' | 'Failed';
}

export const customerPayments: CustomerPayment[] = [
    { id: 'PAY-CUST-001', jobId: 'JOB-0227', ownerId: 'OWNER-02', amount: 250, paymentDate: getDate(8, 5), status: 'Paid' },
    { id: 'PAY-CUST-002', jobId: 'JOB-0225', ownerId: 'OWNER-02', amount: 180, paymentDate: '2024-07-25T14:00:00Z', status: 'Paid' },
    { id: 'PAY-CUST-003', jobId: 'JOB-0224', ownerId: 'OWNER-02', amount: 180, paymentDate: '2024-07-26T15:00:00Z', status: 'Paid' },
    { id: 'PAY-CUST-004', jobId: 'JOB-0210', ownerId: 'OWNER-01', amount: 140, paymentDate: '2024-07-15T18:00:00Z', status: 'Paid' },
    { id: 'PAY-CUST-005', jobId: 'JOB-0211', ownerId: 'OWNER-01', amount: 150, paymentDate: '2024-07-10T16:00:00Z', status: 'Paid' },
    { id: 'PAY-CUST-006', jobId: 'JOB-0201', ownerId: 'OWNER-02', amount: 120, paymentDate: '2024-06-20T17:00:00Z', status: 'Paid' },
    { id: 'PAY-CUST-007', jobId: 'JOB-0202', ownerId: 'OWNER-03', amount: 175, paymentDate: '2024-06-12T19:00:00Z', status: 'Failed' },
    { id: 'PAY-CUST-008', jobId: 'JOB-0190', ownerId: 'OWNER-01', amount: 150, paymentDate: '2024-05-25T14:00:00Z', status: 'Paid' },
];

// --- AUDIT LOG DATA ---
export interface AuditLog {
    id: string;
    timestamp: string; // ISO 8601
    user: string;
    action: string;
    targetId: string; // e.g., 'JOB-0226' or 'CLN-004'
    details?: string;
}
  
const logDate = (hour: number, minute: number, dayOffset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, Math.floor(Math.random() * 60));
    return d.toISOString();
}

export const auditLogs: AuditLog[] = [
    { id: 'LOG-001', timestamp: logDate(15, 36), user: 'Admin User', action: 'Triggered Urgent Replacement', targetId: 'JOB-0226' },
    { id: 'LOG-002', timestamp: logDate(14, 10), user: 'Admin User', action: 'Resolved Dispute: Fault: Cleaner', targetId: 'JOB-0224' },
    { id: 'LOG-003', timestamp: logDate(11, 5), user: 'Admin User', action: 'Subscription Canceled', targetId: 'SUB-004' },
    { id: 'LOG-004', timestamp: logDate(10, 22, -1), user: 'Admin User', action: 'Cleaner Suspended', targetId: 'CLN-004' },
    { id: 'LOG-005', timestamp: logDate(9, 15, -1), user: 'Admin User', action: 'Checklist version set to active', targetId: 'PROP-001 v1' },
    { id: 'LOG-006', timestamp: logDate(17, 45, -2), user: 'Admin User', action: 'Subscription Paused', targetId: 'SUB-003' },
    { id: 'LOG-007', timestamp: logDate(16, 30, -2), user: 'Admin User', action: 'New Cleaner Added', targetId: 'CLN-005' },
    { id: 'LOG-008', timestamp: logDate(13, 1, -3), user: 'System', action: 'Auto-flagged: Late Start', targetId: 'JOB-0230' },
    { id: 'LOG-009', timestamp: getDate(12, 5), user: 'System', action: 'Cleaner Check-in', targetId: 'JOB-0231', details: 'GPS: 29.02, -80.90' },
];

// --- FINANCIAL DATA ---
export interface Payout {
    id: string;
    cleanerId: string;
    jobId: string;
    amount: number; // Final amount after bonuses/deductions
    status: 'Pending' | 'Paid';
    requestDate: string; // ISO 8601
    payoutDate: string | null; // ISO 8601
}

export const payouts: Payout[] = [
    { id: 'PAY-001', cleanerId: 'CLN-002', jobId: 'JOB-0229', amount: 225, status: 'Pending', requestDate: logDate(14, 16), payoutDate: null },
    { id: 'PAY-002', cleanerId: 'CLN-005', jobId: 'JOB-0227', amount: 250, status: 'Paid', requestDate: logDate(13, 31, -1), payoutDate: logDate(8, 0) },
    { id: 'PAY-003', cleanerId: 'CLN-003', jobId: 'JOB-0224', amount: 180, status: 'Paid', requestDate: '2024-07-26T12:46:00Z', payoutDate: '2024-07-27T18:00:00Z' },
    { id: 'PAY-004', cleanerId: 'CLN-001', jobId: 'JOB-0220', amount: 150, status: 'Paid', requestDate: logDate(15, 0, -2), payoutDate: logDate(8, 0, -1) },
    { id: 'PAY-005', cleanerId: 'CLN-002', jobId: 'JOB-0219', amount: 180, status: 'Paid', requestDate: logDate(16, 0, -3), payoutDate: logDate(8, 0, -2) },
    // --- Added for Financial Reporting ---
    { id: 'PAY-007', cleanerId: 'CLN-001', jobId: 'JOB-0190', amount: 150, status: 'Paid', requestDate: '2024-05-25T13:00:00Z', payoutDate: '2024-05-26T08:00:00Z' },
    { id: 'PAY-008', cleanerId: 'CLN-003', jobId: 'JOB-0201', amount: 110, status: 'Paid', requestDate: '2024-06-20T16:00:00Z', payoutDate: '2024-06-21T08:00:00Z' },
    { id: 'PAY-009', cleanerId: 'CLN-005', jobId: 'JOB-0202', amount: 175, status: 'Paid', requestDate: '2024-06-12T18:00:00Z', payoutDate: '2024-06-13T08:00:00Z' },
    { id: 'PAY-010', cleanerId: 'CLN-001', jobId: 'JOB-0210', amount: 140, status: 'Paid', requestDate: '2024-07-15T17:00:00Z', payoutDate: '2024-07-16T08:00:00Z' },
    { id: 'PAY-011', cleanerId: 'CLN-002', jobId: 'JOB-0211', amount: 150, status: 'Paid', requestDate: '2024-07-10T15:00:00Z', payoutDate: '2024-07-11T08:00:00Z' },
];

export interface RefundRequest {
    id: string;
    jobId: string;
    propertyId: string;
    ownerId: string;
    requestedAmount: number;
    reason: string;
    status: 'Pending' | 'Approved' | 'Denied';
    requestDate: string; // ISO 8601
}

export const refundRequests: RefundRequest[] = [
    { id: 'REF-001', jobId: 'JOB-0224', propertyId: 'PROP-008', ownerId: 'OWNER-02', requestedAmount: 50, reason: 'Guest reported bathrooms were not fully cleaned upon arrival.', status: 'Pending', requestDate: logDate(13, 0) },
    { id: 'REF-002', jobId: 'JOB-0215', propertyId: 'PROP-001', ownerId: 'OWNER-01', requestedAmount: 150, reason: 'Cleaner was over 2 hours late, causing guest check-in to be delayed significantly.', status: 'Pending', requestDate: logDate(9, 30, -1) },
    { id: 'REF-003', jobId: 'JOB-0224', propertyId: 'PROP-008', ownerId: 'OWNER-02', requestedAmount: 25, reason: "Refund issued for dispute on Job JOB-0224. Notes: Cleaner forgot to upload photos for 3 checklist items. Issued partial refund to customer.", status: 'Approved', requestDate: '2024-07-26T14:10:00Z' }
];


// --- NOTIFICATION LOG DATA ---
export type NotificationChannel = 'Email' | 'SMS';
export type NotificationStatus = 'Sent' | 'Failed' | 'Pending';
export type NotificationType = 'Booking Confirmed' | 'Cleaning Reminder' | 'Job Completed' | 'Payment Receipt' | 'Subscription Paused';

export interface NotificationLog {
  id: string;
  timestamp: string; // ISO 8601
  ownerId: string;
  type: NotificationType;
  channel: NotificationChannel;
  status: NotificationStatus;
  content: string;
}

export const notificationLogs: NotificationLog[] = [
    { id: 'NOTIF-001', timestamp: logDate(15, 31), ownerId: 'OWNER-01', type: 'Job Completed', channel: 'Email', status: 'Sent', content: 'Your cleaning at 123 Ocean Ave is complete!' },
    { id: 'NOTIF-002', timestamp: logDate(10, 0), ownerId: 'OWNER-02', type: 'Cleaning Reminder', channel: 'SMS', status: 'Sent', content: 'Reminder: Your turnover at 789 Salty Air Ct is scheduled for today at 4:00 PM.' },
    { id: 'NOTIF-003', timestamp: logDate(9, 2), ownerId: 'OWNER-03', type: 'Booking Confirmed', channel: 'Email', status: 'Failed', content: 'Confirmation for your upcoming cleaning at 101 Coral Reef Rd.' },
    { id: 'NOTIF-004', timestamp: logDate(18, 5, -1), ownerId: 'OWNER-01', type: 'Payment Receipt', channel: 'Email', status: 'Sent', content: 'Receipt for your payment of $150.00 for job JOB-0220.' },
    { id: 'NOTIF-005', timestamp: logDate(17, 46, -2), ownerId: 'OWNER-01', type: 'Subscription Paused', channel: 'Email', status: 'Sent', content: 'Your subscription for 456 Beachside Dr has been paused.' },
    { id: 'NOTIF-006', timestamp: logDate(8, 0, -3), ownerId: 'OWNER-02', type: 'Cleaning Reminder', channel: 'SMS', status: 'Sent', content: 'Reminder: Your turnover at 789 Salty Air Ct is scheduled for today.' },
];

// --- JOB SWAP REQUESTS ---
export interface SwapRequest {
    id: string;
    jobId: string;
    requestingCleanerId: string;
    reason: string;
    status: 'Pending' | 'Approved' | 'Denied';
}

export const swapRequests: SwapRequest[] = [
    { id: 'SWAP-001', jobId: 'JOB-0230', requestingCleanerId: 'CLN-003', reason: 'Family emergency, cannot make it.', status: 'Pending' },
    { id: 'SWAP-002', jobId: 'JOB-0226', requestingCleanerId: 'CLN-001', reason: 'Feeling unwell.', status: 'Pending' },
];

// --- NOTIFICATION TEMPLATES ---
export interface NotificationTemplate {
    id: string;
    name: 'Booking Confirmed' | 'Cleaning Reminder' | 'Job Completed' | 'New Job Assignment' | 'Job Reminder (Cleaner)' | 'Payout Processed';
    recipient: 'Customer' | 'Cleaner';
    subject: string;
    body: string;
    variables: string[];
}

export const notificationTemplates: NotificationTemplate[] = [
    {
        id: 'TPL-001',
        name: 'Cleaning Reminder',
        recipient: 'Customer',
        subject: 'Reminder: Upcoming Turnover for {propertyAddress}',
        body: 'Hi {ownerName},\n\nThis is a friendly reminder that you have a turnover scheduled for your property at {propertyAddress} on {jobDate} at {jobTime}.\n\nThank you,\nThe CleanNami Team',
        variables: ['ownerName', 'propertyAddress', 'jobDate', 'jobTime'],
    },
    {
        id: 'TPL-002',
        name: 'Job Completed',
        recipient: 'Customer',
        subject: 'Your Turnover at {propertyAddress} is Complete!',
        body: 'Hi {ownerName},\n\nGreat news! The turnover for your property at {propertyAddress} has just been completed by {cleanerName}.\n\nYou can view the job details and evidence photos in your portal.\n\nThanks for choosing CleanNami!',
        variables: ['ownerName', 'propertyAddress', 'cleanerName'],
    },
    {
        id: 'TPL-003',
        name: 'Booking Confirmed',
        recipient: 'Customer',
        subject: 'Booking Confirmed for {propertyAddress}',
        body: 'Hi {ownerName},\n\nYour new booking for {propertyAddress} is confirmed. We will automatically schedule a turnover after your guest checks out.\n\nThank you,\nThe CleanNami Team',
        variables: ['ownerName', 'propertyAddress'],
    },
    {
        id: 'TPL-101',
        name: 'New Job Assignment',
        recipient: 'Cleaner',
        subject: 'New Job Assignment: {propertyAddress} on {jobDate}',
        body: 'Hi {cleanerName},\n\nYou have been assigned a new turnover job at {propertyAddress} scheduled for {jobDate} at {jobTime}. Please confirm your availability in the cleaner portal.\n\nJob ID: {jobId}',
        variables: ['cleanerName', 'propertyAddress', 'jobDate', 'jobTime', 'jobId'],
    },
    {
        id: 'TPL-102',
        name: 'Job Reminder (Cleaner)',
        recipient: 'Cleaner',
        subject: 'Reminder: Job at {propertyAddress} tomorrow',
        body: 'Hi {cleanerName},\n\nThis is a reminder for your upcoming job at {propertyAddress} tomorrow, {jobDate}, at {jobTime}.\n\nJob ID: {jobId}',
        variables: ['cleanerName', 'propertyAddress', 'jobDate', 'jobTime', 'jobId'],
    },
    {
        id: 'TPL-103',
        name: 'Payout Processed',
        recipient: 'Cleaner',
        subject: 'Your Payout of {payoutAmount} Has Been Sent',
        body: 'Hi {cleanerName},\n\nYour payout of {payoutAmount} for job {jobId} has been processed and should arrive in your account within 3-5 business days.\n\nThank you for your hard work!',
        variables: ['cleanerName', 'payoutAmount', 'jobId'],
    },
];