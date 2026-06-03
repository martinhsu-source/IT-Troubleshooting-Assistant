
import { TroubleshootingRecord } from './types';

export const INITIAL_RECORDS: TroubleshootingRecord[] = [
  {
    id: 'TR-001',
    date: '2023-10-15',
    category: 'Network',
    issue: 'WiFi intermittent disconnects in Meeting Room B',
    solution: 'Updated driver for AP-04 and changed channel width to 20MHz to reduce interference.',
    status: 'Resolved'
  },
  {
    id: 'TR-002',
    date: '2023-11-02',
    category: 'Printing',
    issue: 'Users unable to print from MacBooks to Printer 02',
    solution: 'Re-installed Bonjour print services and updated the PPD file on local machines.',
    status: 'Resolved'
  },
  {
    id: 'TR-003',
    date: '2023-11-10',
    category: 'Software',
    issue: 'Outlook slow and hanging when searching old emails',
    solution: 'Rebuilt indexing in Windows Search and compacted the PST data file.',
    status: 'Resolved'
  },
  {
    id: 'TR-004',
    date: '2024-01-05',
    category: 'Hardware',
    issue: 'Monitor flickering after power surge',
    solution: 'Replaced HDMI cable and updated internal GPU firmware.',
    status: 'Resolved'
  },
  {
    id: 'TR-005',
    date: '2024-02-12',
    category: 'Access Control',
    issue: 'VPN login failing with 2FA timeout',
    solution: 'Synchronized server time on Domain Controller and reset user RADIUS token.',
    status: 'Resolved'
  }
];
