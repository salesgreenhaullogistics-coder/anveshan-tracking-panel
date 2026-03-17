// Raw Status → Correct Normalized Status mapping
// Source: Right Status.xlsx reference sheet
const STATUS_MAP = {
  'Delivered': 'Delivered',
  'RTO Delivered': 'RTO Delivered',
  'pending': 'In-Transit',
  'intransit': 'In-Transit',
  'RTO - Delivered': 'RTO Delivered',
  'Lost': 'Lost',
  'Partial Delivered': 'Partial Delivered',
  'GRN Done - POD Missed': 'Delivered',
  'Partially Delivered - RTO': 'Partial RTO Delivered',
  'RTO - Pending for delivery': 'RTO - In Transit',
  'RTO - In transit': 'RTO - In Transit',
  'RTO - Pending with Gracious': 'RTO - In Transit',
  'RTO - OFD': 'RTO - In Transit',
  'RTO - Document Pending': 'RTO - In Transit',
  'f6001029324': 'Other',
  'POD Pending': 'Delivered',
  'OFD': 'In-Transit',
  'In transit': 'In-Transit',
  'RTO': 'RTO Delivered',
  'return': 'RTO Delivered',
  'Slot not booked': 'Other',
  'NA': 'Other',
  'refsue': 'Other',
  'UNDELIVERED': 'In-Transit',
  'Undelviered': 'In-Transit',
  'RTV issue': 'Other',
  'due to holi festival': 'Other',
  'in trasit not book appoitment': 'Other',
  'po issue': 'Other',
  'pendong': 'In-Transit',
  'in trasit': 'In-Transit',
  'not pick': 'Other',
  'RTO-Delivered': 'RTO Delivered',
  'RTO-Intransit': 'RTO - In Transit',
  'RTO - Documents Received': 'RTO - In Transit',
};

// Build case-insensitive lookup for better matching
const CASE_INSENSITIVE_STATUS = {};
for (const [key, value] of Object.entries(STATUS_MAP)) {
  CASE_INSENSITIVE_STATUS[key.toLowerCase().trim()] = value;
}

/**
 * Corrects a raw status string to its normalized form using the reference mapping.
 * Empty / blank / header-row statuses → 'Other'.
 * Falls back to the original trimmed value if no mapping match is found.
 */
export function correctStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') return 'Other';
  const trimmed = rawStatus.trim();
  if (!trimmed || trimmed.toLowerCase() === 'status') return 'Other';
  // Exact match first, then case-insensitive
  return STATUS_MAP[trimmed] || CASE_INSENSITIVE_STATUS[trimmed.toLowerCase()] || trimmed;
}

export default STATUS_MAP;
