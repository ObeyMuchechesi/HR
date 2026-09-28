/**
 * Seed script — wipes all collections and reseeds from the
 * "CALL CENTER LEAVE SCHEDULE JULY - SEPTEMBER 2026" spreadsheet.
 *
 *   - 1 department (Call Center), 5 employees
 *   - A login for every employee (role employee) + admin account for Obey
 *   - Approved leave records for every date in the schedule
 *   - Payroll for every employee for Jan-Sep 2026: $300 net, marked Paid
 *
 * Usage:  node seed.js
 */
require('dotenv').config({ override: true });
const mongoose = require('mongoose');
const Employee = require('./models/Employee');
const Department = require('./models/Department');
const User = require('./models/User');
const Leave = require('./models/Leave');
const Attendance = require('./models/Attendance');
const Payroll = require('./models/Payroll');

const PASSWORD = 'Password123';

// ---------- Schedule parsed from "Leave schedule.xlsx" ----------
// Excel serial dates converted: 46216=2026-07-13, 46234=2026-07-31, 46289=2026-09-24
// "08/09; 16/08/;24/09/2026" is read literally as dd/mm (the sheet mixes months
// under the September column); Lisa's Sept count says 5 but only 2 dates are listed.
const STAFF = [
  {
    firstName: 'Ashley', lastName: 'Maspeak', email: 'ashley@callcentral.com',
    position: 'Call Center Agent', employeeId: 'CC-001',
    leaveBlocks: [
      { start: '2026-07-13', end: '2026-07-13' },                       // July: 1 day (serial 46216)
      { start: '2026-08-16', end: '2026-08-16' },                       // "16/08"
      { start: '2026-09-08', end: '2026-09-08' },                       // "08/09"
      { start: '2026-09-24', end: '2026-09-24' },                       // "24/09/2026"
    ],
  },
  {
    firstName: 'Fadzai', lastName: 'Mate', email: 'fadzai@callcentral.com',
    position: 'Call Center Agent', employeeId: 'CC-002',
    leaveBlocks: [
      { start: '2026-08-12', end: '2026-08-14' },                       // 12/08-14/08/2026
      { start: '2026-09-24', end: '2026-09-24' },                       // serial 46289
    ],
  },
  {
    firstName: 'Lisa', lastName: 'Tandire', email: 'lisa@callcentral.com',
    position: 'Call Center Agent', employeeId: 'CC-003',
    leaveBlocks: [
      { start: '2026-07-10', end: '2026-07-10' },                       // 10/07
      { start: '2026-07-17', end: '2026-07-17' },                       // 17/07
      { start: '2026-07-21', end: '2026-07-21' },                       // 21/07
      { start: '2026-09-08', end: '2026-09-08' },                       // 08/09
      { start: '2026-09-14', end: '2026-09-14' },                       // 14/09
    ],
  },
  {
    firstName: 'Liliosa', lastName: 'Zinyemba', email: 'liliosa@callcentral.com',
    position: 'Call Center Agent', employeeId: 'CC-004',
    leaveBlocks: [
      { start: '2026-07-31', end: '2026-07-31' },                       // serial 46234
      { start: '2026-08-20', end: '2026-08-21' },                       // 20/08-21/08/2026
      { start: '2026-09-04', end: '2026-09-04' },                       // 4/9
      { start: '2026-09-18', end: '2026-09-18' },                       // 18/09
      { start: '2026-09-24', end: '2026-09-24' },                       // 24/09/2026
    ],
  },
  {
    firstName: 'Obey', lastName: 'Muchechesi', email: 'obey@hr.local',
    position: 'Call Center Supervisor', employeeId: 'CC-000', isAdmin: true,
    leaveBlocks: [
      { start: '2026-08-12', end: '2026-08-14' },                       // 12/08-14/08/2026
    ],
  },
];

const daysBetweenInclusive = (startStr, endStr) => {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  return Math.round((end - start) / 86400000) + 1;
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // ---------- Wipe ----------
  const wiped = {};
  for (const [name, model] of Object.entries({
    employees: Employee, departments: Department, users: User,
    leaves: Leave, attendance: Attendance, payroll: Payroll,
  })) {
    wiped[name] = (await model.deleteMany({})).deletedCount;
  }
  console.log('🗑️  Wiped collections:', JSON.stringify(wiped));

  // ---------- Department ----------
  const dept = await Department.create({
    name: 'Call Center', code: 'CC',
    description: 'Call Center team (from Leave schedule Jul-Sep 2026)',
    location: 'HQ', budget: 20000,
  });
  console.log('🏢 Department created: Call Center (CC)');

  // ---------- Employees + Users + Leaves ----------
  const adminUser = []; // filled after Obey is created (approver for all leaves)
  const created = [];

  for (const person of STAFF) {
    const leaveDays = person.leaveBlocks.reduce(
      (sum, b) => sum + daysBetweenInclusive(b.start, b.end), 0
    );

    const employee = await Employee.create({
      employeeId: person.employeeId,
      firstName: person.firstName,
      lastName: person.lastName,
      email: person.email,
      department: dept._id,
      position: person.position,
      employmentType: 'Full-time',
      hireDate: new Date('2026-04-01T00:00:00'), // leave accumulated from April (per sheet note)
      salary: 300,
      status: 'Active',
      // Annual balance after the scheduled days are taken (starts at 20)
      leaveBalance: { annual: Math.max(0, 20 - leaveDays), sick: 10, personal: 5 },
    });

    const user = await User.create({
      name: `${person.firstName} ${person.lastName}`,
      email: person.email,
      password: PASSWORD,
      role: person.isAdmin ? 'admin' : 'employee',
      employee: employee._id,
    });

    if (person.isAdmin) adminUser.push(user);
    created.push({ person, employee, leaveDays });
    console.log(`👤 ${person.firstName} ${person.lastName} (${person.employeeId}) — ${leaveDays} leave day(s), role: ${user.role}`);
  }

  const approver = adminUser[0] || null;

  // ---------- Leave records ----------
  let leaveCount = 0;
  for (const { person, employee } of created) {
    for (const block of person.leaveBlocks) {
      await Leave.create({
        employee: employee._id,
        leaveType: 'Annual',
        startDate: new Date(block.start + 'T00:00:00'),
        endDate: new Date(block.end + 'T00:00:00'),
        days: daysBetweenInclusive(block.start, block.end),
        reason: 'Leave schedule Jul-Sep 2026 (spreadsheet)',
        status: 'Approved',
        approvedBy: approver ? approver._id : undefined,
        approvedAt: new Date(),
      });
      leaveCount++;
    }
  }
  console.log(`🌴 Leave records created: ${leaveCount} (all Approved)`);

  // ---------- Payroll: Jan-Sep 2026, $300 net, all Paid ----------
  let payrollCount = 0;
  for (const { employee } of created) {
    for (let month = 1; month <= 9; month++) {
      const paidAt = new Date(Date.UTC(2026, month, 0)); // last day of that month
      await Payroll.create({
        employee: employee._id,
        month, year: 2026,
        basicSalary: 300,
        allowances: { housing: 0, transport: 0, medical: 0, other: 0 },
        deductions: { tax: 0, pension: 0, insurance: 0, other: 0 },
        netPay: 300,
        status: 'Paid',
        paidAt,
      });
      payrollCount++;
    }
  }
  console.log(`💰 Payroll records created: ${payrollCount} (Jan-Sep 2026 × 5 staff, $300 each, all Paid)`);

  // ---------- Attendance: Mon-Fri 07:50-16:00, 1 May 2026 -> today ----------
  // Every employee except Obey; approved leave days are skipped (no check-in on leave).
  const CHECK_IN_H = 7, CHECK_IN_M = 50;
  const CHECK_OUT_H = 16, CHECK_OUT_M = 0;
  const hoursWorked = 8.17; // 07:50 -> 16:00

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayKey = (d) => d.toISOString().slice(0, 10);

  let attendanceCount = 0;
  for (const { person, employee } of created) {
    if (person.isAdmin) continue; // everyone except Obey

    // Expand this person's approved leave blocks into a skip-set
    const onLeave = new Set();
    for (const block of person.leaveBlocks) {
      const cursor = new Date(block.start + 'T00:00:00');
      const end = new Date(block.end + 'T00:00:00');
      while (cursor <= end) {
        onLeave.add(dayKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    const cursor = new Date('2026-05-01T00:00:00');
    while (cursor <= today) {
      const dow = cursor.getDay();
      const isWeekday = dow >= 1 && dow <= 5;
      if (isWeekday && !onLeave.has(dayKey(cursor))) {
        const checkIn = new Date(cursor);
        checkIn.setHours(CHECK_IN_H, CHECK_IN_M, 0, 0);
        const checkOut = new Date(cursor);
        checkOut.setHours(CHECK_OUT_H, CHECK_OUT_M, 0, 0);
        await Attendance.create({
          employee: employee._id,
          date: new Date(cursor),
          checkIn,
          checkOut,
          status: 'Present',
          hoursWorked,
          notes: '',
        });
        attendanceCount++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  console.log(`🕐 Attendance records created: ${attendanceCount} (Mon-Fri, 07:50-16:00, 1 May -> today, leave days skipped)`);

  await mongoose.disconnect();
  console.log('\n🎉 Seed complete. Logins (password for ALL: ' + PASSWORD + '):');
  STAFF.forEach(p => console.log(`   ${p.email}  (${p.isAdmin ? 'admin' : 'employee'})`));
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
