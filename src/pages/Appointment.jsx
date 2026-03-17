import React, { useMemo, useState } from 'react';
import { useData } from '../context/DataContext';
import DataTable from '../components/DataTable';
import KPICard from '../components/KPICard';
import { PieChart } from '../components/Charts';
import { Calendar, CalendarCheck, CalendarX, CalendarClock } from 'lucide-react';
import { safeParseDate, formatDate } from '../utils/index';
import { format, isToday } from 'date-fns';

const SUB_TABS = ['Appointment Booked', 'Non Appointment', 'Today Appointment', 'Request Appointment'];

const COLUMNS = [
  { key: 'awbNo', label: 'AWB No' },
  { key: 'invoiceNo', label: 'Invoice No' },
  { key: 'vendor', label: 'Courier' },
  { key: 'platform', label: 'Platform' },
  { key: 'destination', label: 'Destination' },
  { key: 'status', label: 'Status' },
  { key: 'bookingDate', label: 'Booking Date', render: (val) => formatDate(val) },
  { key: 'appointmentDate', label: 'Appointment Date', render: (val) => formatDate(val) },
  { key: 'edd', label: 'EDD', render: (val) => formatDate(val) },
  { key: 'zone', label: 'Zone' },
  { key: 'poNumber', label: 'PO Number' },
];

export default function Appointment() {
  const { data } = useData();
  const [subTab, setSubTab] = useState('Appointment Booked');

  const categorized = useMemo(() => {
    const booked = [];
    const nonAppointment = [];
    const todayAppt = [];
    const requestAppt = [];

    data.forEach((row) => {
      const apptDate = safeParseDate(row.appointmentDate);
      if (apptDate) {
        booked.push(row);
        if (isToday(apptDate)) {
          todayAppt.push(row);
        }
      } else if (row.appointmentDate && row.appointmentDate.trim() !== '') {
        requestAppt.push(row);
      } else {
        nonAppointment.push(row);
      }
    });

    return { booked, nonAppointment, todayAppt, requestAppt };
  }, [data]);

  const activeData = useMemo(() => {
    switch (subTab) {
      case 'Appointment Booked': return categorized.booked;
      case 'Non Appointment': return categorized.nonAppointment;
      case 'Today Appointment': return categorized.todayAppt;
      case 'Request Appointment': return categorized.requestAppt;
      default: return [];
    }
  }, [subTab, categorized]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard title="Appointment Booked" value={categorized.booked.length} icon={CalendarCheck} color="green" />
        <KPICard title="Non Appointment" value={categorized.nonAppointment.length} icon={CalendarX} color="red" />
        <KPICard title="Today's Appointments" value={categorized.todayAppt.length} icon={Calendar} color="blue" />
        <KPICard title="Request Appointment" value={categorized.requestAppt.length} icon={CalendarClock} color="yellow" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="chart-container lg:col-span-1">
          <PieChart
            title="Appointment Breakdown"
            labels={['Booked', 'Non Appointment', 'Request']}
            data={[categorized.booked.length, categorized.nonAppointment.length, categorized.requestAppt.length]}
            height={200}
          />
        </div>
        <div className="lg:col-span-2">
          <div className="flex gap-2 mb-4 flex-wrap">
            {SUB_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setSubTab(tab)}
                className={`tab-btn ${subTab === tab ? 'tab-btn-active' : 'tab-btn-inactive'}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <DataTable
            data={activeData}
            columns={COLUMNS}
            exportFilename={`appointment-${subTab.toLowerCase().replace(/\s/g, '-')}`}
          />
        </div>
      </div>
    </div>
  );
}
