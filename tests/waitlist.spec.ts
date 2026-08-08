import { test, expect } from '@playwright/test';
import {
  createFamily,
  createStudent,
  queryDb,
  runWpCli,
  selectFromSelect2,
  switchToUser,
  uniqueFamilyDetails,
} from './helpers';

// Verifies the "this class is full" signaling on both purchase surfaces (see
// registration.spec.ts / storefront-purchase.spec.ts for the corresponding
// non-full paths) - just the display/UI for now, not the act of actually
// adding a student to the waitlist (a separate, later test).
//
// "Test Clinic"'s capacity is fixed by the fixture at 10
// (tests/fixtures/e2e-sessions.json), and is a single, UNSHARED reservation
// group (see Usctdp_Mgmt_Reservation_Group_Table) - the simple case named in
// the task. A later test can cover two clinics sharing one group instead.
//
// This suite runs single-worker/serial against one seeded DB with no
// automatic reset between spec files (playwright.config.ts), and every other
// spec file that touches "Test Clinic" (registration.spec.ts,
// storefront-purchase.spec.ts) adds real registrations against it. So:
//   - the number of filler registrations needed to reach capacity is
//     computed from the clinic's CURRENT active count, not assumed to start
//     at 0 - this doesn't care what ran before it, in this file or any
//     other.
//   - filler students/family are created directly in the DB (not through
//     the UI) purely to occupy seats - nothing about them is under test.
//   - every filler registration this file creates is deleted again in
//     afterAll, so it doesn't leave "Test Clinic" full for whatever spec
//     file happens to run after it.
test.describe('single clinic at full capacity', () => {
  let activityId: string;
  let capacity: number;
  let fillerFamilyId: string | undefined;
  let fillerRegistrationIds: string[] = [];

  test.beforeAll(() => {
    const [clinicRow] = queryDb(`
      SELECT act.id AS activity_id, act.reservation_group_id AS group_id, resg.capacity AS capacity
      FROM wp_usctdp_activity act
      JOIN wp_usctdp_product prod ON act.product_id = prod.id
      JOIN wp_usctdp_reservation_group resg ON act.reservation_group_id = resg.id
      WHERE prod.title = 'Test Clinic'
    `);
    expect(clinicRow).toBeTruthy();
    activityId = clinicRow.activity_id;
    const groupId = clinicRow.group_id;
    capacity = Number(clinicRow.capacity);

    const [countRow] = queryDb(`
      SELECT COUNT(*) AS count FROM wp_usctdp_registration reg
      JOIN wp_usctdp_activity act ON act.id = reg.activity_id
      WHERE act.reservation_group_id = ${groupId} AND reg.status = 'active'
    `);
    const alreadyRegistered = Number(countRow.count);
    const fillerCount = capacity - alreadyRegistered;
    // If this ever fails, either the fixture's capacity changed or some
    // other spec file registered more students against "Test Clinic" than
    // this accounts for - both worth investigating, not silently working
    // around.
    expect(fillerCount).toBeGreaterThan(0);

    const uniqueTag = `filler-${Date.now()}`;
    queryDb(`INSERT INTO wp_usctdp_family (title, last) VALUES ('${uniqueTag}', '${uniqueTag}')`);
    const [fillerFamily] = queryDb(`SELECT id FROM wp_usctdp_family WHERE last = '${uniqueTag}'`);
    fillerFamilyId = fillerFamily.id;

    const studentValues = Array.from(
      { length: fillerCount },
      (_, i) => `(${fillerFamilyId}, 'Filler ${i} ${uniqueTag}', 'Filler${i}', '${uniqueTag}')`
    ).join(', ');
    queryDb(`INSERT INTO wp_usctdp_student (family_id, title, first, last) VALUES ${studentValues}`);
    const fillerStudents = queryDb(`SELECT id FROM wp_usctdp_student WHERE family_id = ${fillerFamilyId}`);
    expect(fillerStudents).toHaveLength(fillerCount);

    // purchase_id=0 / created_by=modified_by=0: these registrations don't
    // correspond to a real purchase or a real logged-in user - 0 is the
    // same "no real user" sentinel get_current_user_id() already returns
    // in a CLI/no-session context elsewhere in this codebase.
    const regValues = fillerStudents
      .map((s) => `(0, ${activityId}, ${s.id}, 'active', NOW(), 0, NOW(), 0, '')`)
      .join(', ');
    queryDb(`
      INSERT INTO wp_usctdp_registration
        (purchase_id, activity_id, student_id, status, created_at, created_by, modified_at, modified_by, notes)
      VALUES ${regValues}
    `);
    const fillerRegistrations = queryDb(
      `SELECT id FROM wp_usctdp_registration WHERE activity_id = ${activityId} AND student_id IN (${fillerStudents.map((s) => s.id).join(',')})`
    );
    fillerRegistrationIds = fillerRegistrations.map((r) => r.id);
    expect(fillerRegistrationIds).toHaveLength(fillerCount);
  });

  test.afterAll(() => {
    if (fillerRegistrationIds.length > 0) {
      queryDb(`DELETE FROM wp_usctdp_registration WHERE id IN (${fillerRegistrationIds.join(',')})`);
    }
    if (fillerFamilyId) {
      queryDb(`DELETE FROM wp_usctdp_student WHERE family_id = ${fillerFamilyId}`);
      queryDb(`DELETE FROM wp_usctdp_family WHERE id = ${fillerFamilyId}`);
    }
  });

  test('admin register page shows the class as full and offers Add to Waitlist', async ({ page }) => {
    const family = uniqueFamilyDetails();
    await createFamily(page, family);

    const student = {
      firstName: 'Observer',
      lastName: family.lastName,
      birthdate: '2015-06-01',
      level: 'Beginner',
    };
    await createStudent(page, student);

    await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-register');

    await selectFromSelect2(page, 'family-selector', family.lastName);
    await selectFromSelect2(page, 'student-selector', student.firstName);
    await selectFromSelect2(page, 'session-selector', 'Test Session');
    await selectFromSelect2(page, 'clinic-selector', 'Test Clinic');
    await selectFromSelect2(page, 'activity-selector', 'Test Clinic');

    // bind_activity_basic_info() (usctdp-mgmt-admin-register.js) populates
    // current/max size and the red/green badge unconditionally, before the
    // full/not-full branch below even runs.
    await expect(page.locator('#activity-current-size')).toHaveText(String(capacity));
    await expect(page.locator('#activity-max-size')).toHaveText(String(capacity));
    await expect(page.locator('#activity-capacity .activity-capacity-value')).toHaveClass(/red-bg/);

    // loadClinicRegistration()'s full branch: the normal registration form
    // (#activity-preorder) never appears - an "activity full" notification
    // with an Add to Waitlist action shows instead.
    await expect(page.locator('#activity-preorder')).toBeHidden();
    const notification = page.locator('#activity-full-notification');
    await expect(notification).toBeVisible();
    await expect(notification).toContainText('This activity is full.');
    await expect(notification.locator('#waitlist-student-btn')).toBeVisible();
    await expect(notification.locator('#waitlist-student-btn')).toHaveText('Add to Waitlist');
  });

  test('WooCommerce product page shows the day as full and offers Add to Waitlist', async ({ page }) => {
    const family = uniqueFamilyDetails();
    await createFamily(page, family);

    const student = {
      firstName: 'Observer',
      lastName: family.lastName,
      birthdate: '2015-06-01',
      level: 'Beginner',
    };
    await createStudent(page, student);

    await switchToUser(page, family.email);

    await page.goto('/product/test-clinic/');
    await page.locator('#days-per-week').selectOption('One');
    await selectFromSelect2(page, 'student_select', student.firstName);
    // Still matches on "Monday" fine even though the option's text now has
    // a "(Full)" suffix appended (add_day_selector() in
    // usctdp-mgmt-product.js) - selectFromSelect2 matches by substring.
    await selectFromSelect2(page, 'day_of_week_1', 'Monday');

    // updateDayStatus() reveals the status block (force-hidden by default -
    // see usctdp-mgmt-product.css) once the selected option's data-full is
    // true, instead of letting the student add the class to their cart.
    const daySelector = page.locator('.usctdp-day-selector').first();
    await expect(daySelector.locator('.usctdp-day-status')).toBeVisible();
    await expect(daySelector.locator('.usctdp-full-message')).toHaveText('This class is full.');
    const waitlistBtn = daySelector.locator('.add-waitlist-btn');
    await expect(waitlistBtn).toBeVisible();
    await expect(waitlistBtn).toHaveText('Add to Waitlist');
    await expect(waitlistBtn).toBeEnabled();

    // updateCartAvailability() blocks the add-to-cart button too, whenever
    // any currently-selected day is full.
    await expect(page.locator('.single_add_to_cart_button')).toHaveClass(/usctdp-cart-disabled/);
  });
});

// The reservation-group case: two DIFFERENT clinic activities merged into
// one shared capacity pool (see Usctdp_Mgmt_Reservation_Group_Table).
// "Test Clinic" only has one class/day in the fixture (Monday), so this
// creates a second, synthetic clinic activity (Wednesday, same product +
// session) directly in the DB, then merges the two together with the REAL
// `wp usctdp merge_reservation_group` CLI command - not a hand-rolled
// imitation of what merging does, the actual tool an admin would run.
//
// The core thing this proves: registrations are deliberately split
// UNEVENLY across the two clinics, so neither one's own direct count
// reaches the shared capacity - only the SUM across both does. If either
// UI surface fell back to counting just the one specific activity_id
// (the bug this whole reservation-group feature exists to fix - see
// get_activity_enrollment_counts()/get_enrolled_counts_by_group()), the
// less-loaded clinic would incorrectly still show as having room.
//
// Same cleanup discipline as the block above: everything this creates
// (the synthetic activity/clinic/group rows, the filler registrations) is
// removed in afterAll, restoring "Test Clinic" to its original solo
// reservation group so later spec files/runs aren't affected.
test.describe('two clinics sharing a reservation group at full capacity', () => {
  let clinic1ActivityId: string;
  let clinic2ActivityId: string | undefined;
  let sharedGroupId: string | undefined;
  let sharedCapacity: number;
  let originalClinic1Capacity: number;
  let fillerFamilyId: string | undefined;
  let fillerRegistrationIds: string[] = [];

  test.beforeAll(() => {
    const [clinic1] = queryDb(`
      SELECT act.id AS activity_id, act.session_id AS session_id, act.product_id AS product_id,
             act.level AS level, resg.capacity AS capacity
      FROM wp_usctdp_activity act
      JOIN wp_usctdp_product prod ON act.product_id = prod.id
      JOIN wp_usctdp_reservation_group resg ON act.reservation_group_id = resg.id
      WHERE prod.title = 'Test Clinic'
    `);
    expect(clinic1).toBeTruthy();
    clinic1ActivityId = clinic1.activity_id;
    originalClinic1Capacity = Number(clinic1.capacity);

    const [countRow] = queryDb(`
      SELECT COUNT(*) AS count FROM wp_usctdp_registration
      WHERE activity_id = ${clinic1ActivityId} AND status = 'active'
    `);
    const alreadyRegisteredOnClinic1 = Number(countRow.count);

    // A brand-new, dedicated throwaway group for the synthetic second
    // clinic - merge_reservation_group (below) replaces it with the real
    // shared group and deletes this one automatically, same as it would
    // for any other pair of activities being merged for the first time.
    queryDb(`INSERT INTO wp_usctdp_reservation_group (capacity, created_at, updated_at) VALUES (0, NOW(), NOW())`);
    const [throwawayGroup] = queryDb(`SELECT id FROM wp_usctdp_reservation_group ORDER BY id DESC LIMIT 1`);

    const uniqueTag = `shared-${Date.now()}`;
    const title = `Test Clinic, Wednesday, 3:30 PM to 4:15 PM (${uniqueTag})`;
    queryDb(`
      INSERT INTO wp_usctdp_activity (session_id, product_id, type, title, level, search_term, reservation_group_id)
      VALUES (${clinic1.session_id}, ${clinic1.product_id}, 'clinic', '${title}', '${clinic1.level}', 'Wednesday ${uniqueTag}', ${throwawayGroup.id})
    `);
    const [clinic2] = queryDb(`SELECT id FROM wp_usctdp_activity WHERE title = '${title}'`);
    clinic2ActivityId = clinic2.id;
    queryDb(
      `INSERT INTO wp_usctdp_clinic (id, day_of_week, start_time, end_time) VALUES (${clinic2ActivityId}, 3, '15:30:00', '16:15:00')`
    );

    // Real merge, same tool an admin would run - creates one brand-new
    // shared group, repoints both activities at it, and deletes their old
    // (now-orphaned) dedicated groups.
    sharedCapacity = alreadyRegisteredOnClinic1 + 4;
    runWpCli([
      'usctdp',
      'merge_reservation_group',
      clinic1ActivityId,
      clinic2ActivityId,
      `--capacity=${sharedCapacity}`,
    ]);

    const [groupRow] = queryDb(`SELECT reservation_group_id FROM wp_usctdp_activity WHERE id = ${clinic1ActivityId}`);
    sharedGroupId = groupRow.reservation_group_id;

    // Split filler unevenly: clinic 2 (Wednesday, the one the tests below
    // actually pick) only takes 3 of the 4 filler seats needed to reach
    // sharedCapacity, clinic 1 (Monday) takes the rest. Neither clinic's
    // own direct registration count reaches sharedCapacity alone - only
    // the two together do.
    const fillerOnClinic1 = 1;
    const fillerOnClinic2 = 3;
    const totalFiller = fillerOnClinic1 + fillerOnClinic2;

    queryDb(`INSERT INTO wp_usctdp_family (title, last) VALUES ('${uniqueTag}', '${uniqueTag}')`);
    const [fillerFamily] = queryDb(`SELECT id FROM wp_usctdp_family WHERE last = '${uniqueTag}'`);
    fillerFamilyId = fillerFamily.id;

    const studentValues = Array.from(
      { length: totalFiller },
      (_, i) => `(${fillerFamilyId}, 'Filler ${i} ${uniqueTag}', 'Filler${i}', '${uniqueTag}')`
    ).join(', ');
    queryDb(`INSERT INTO wp_usctdp_student (family_id, title, first, last) VALUES ${studentValues}`);
    const fillerStudents = queryDb(`SELECT id FROM wp_usctdp_student WHERE family_id = ${fillerFamilyId} ORDER BY id ASC`);
    expect(fillerStudents).toHaveLength(totalFiller);

    const clinic1Students = fillerStudents.slice(0, fillerOnClinic1);
    const clinic2Students = fillerStudents.slice(fillerOnClinic1);

    // purchase_id=0 / created_by=modified_by=0: same "no real purchase, no
    // real user" sentinel as the single-clinic block above.
    const regValues = [
      ...clinic1Students.map((s) => `(0, ${clinic1ActivityId}, ${s.id}, 'active', NOW(), 0, NOW(), 0, '')`),
      ...clinic2Students.map((s) => `(0, ${clinic2ActivityId}, ${s.id}, 'active', NOW(), 0, NOW(), 0, '')`),
    ].join(', ');
    queryDb(`
      INSERT INTO wp_usctdp_registration
        (purchase_id, activity_id, student_id, status, created_at, created_by, modified_at, modified_by, notes)
      VALUES ${regValues}
    `);
    const fillerRegistrations = queryDb(
      `SELECT id FROM wp_usctdp_registration WHERE student_id IN (${fillerStudents.map((s) => s.id).join(',')})`
    );
    fillerRegistrationIds = fillerRegistrations.map((r) => r.id);
    expect(fillerRegistrationIds).toHaveLength(totalFiller);
  });

  test.afterAll(() => {
    if (fillerRegistrationIds.length > 0) {
      queryDb(`DELETE FROM wp_usctdp_registration WHERE id IN (${fillerRegistrationIds.join(',')})`);
    }
    if (fillerFamilyId) {
      queryDb(`DELETE FROM wp_usctdp_student WHERE family_id = ${fillerFamilyId}`);
      queryDb(`DELETE FROM wp_usctdp_family WHERE id = ${fillerFamilyId}`);
    }

    // Restore "Test Clinic" (clinic 1) to its own fresh dedicated group at
    // its original capacity, then remove the synthetic Wednesday clinic and
    // the shared group entirely - back to exactly how every other spec file
    // (and this file's first describe block) expects to find it.
    if (clinic1ActivityId && originalClinic1Capacity) {
      queryDb(
        `INSERT INTO wp_usctdp_reservation_group (capacity, created_at, updated_at) VALUES (${originalClinic1Capacity}, NOW(), NOW())`
      );
      const [restoredGroup] = queryDb(`SELECT id FROM wp_usctdp_reservation_group ORDER BY id DESC LIMIT 1`);
      queryDb(`UPDATE wp_usctdp_activity SET reservation_group_id = ${restoredGroup.id} WHERE id = ${clinic1ActivityId}`);
    }
    if (sharedGroupId) {
      queryDb(`DELETE FROM wp_usctdp_reservation_group WHERE id = ${sharedGroupId}`);
    }
    if (clinic2ActivityId) {
      queryDb(`DELETE FROM wp_usctdp_clinic WHERE id = ${clinic2ActivityId}`);
      queryDb(`DELETE FROM wp_usctdp_activity WHERE id = ${clinic2ActivityId}`);
    }
  });

  test('admin register page shows the class as full via the shared group, even for the less-loaded clinic', async ({
    page,
  }) => {
    const family = uniqueFamilyDetails();
    await createFamily(page, family);

    const student = {
      firstName: 'Observer',
      lastName: family.lastName,
      birthdate: '2015-06-01',
      level: 'Beginner',
    };
    await createStudent(page, student);

    await page.goto('/wp/wp-admin/admin.php?page=usctdp-admin-register');

    await selectFromSelect2(page, 'family-selector', family.lastName);
    await selectFromSelect2(page, 'student-selector', student.firstName);
    await selectFromSelect2(page, 'session-selector', 'Test Session');
    await selectFromSelect2(page, 'clinic-selector', 'Test Clinic');
    // The less-loaded clinic specifically (3 direct registrations, not
    // sharedCapacity) - selecting it should still read as full, because
    // get_activity_enrollment_counts() sums across the whole shared group,
    // not just this one activity_id.
    await selectFromSelect2(page, 'activity-selector', 'Wednesday');

    await expect(page.locator('#activity-current-size')).toHaveText(String(sharedCapacity));
    await expect(page.locator('#activity-max-size')).toHaveText(String(sharedCapacity));
    await expect(page.locator('#activity-capacity .activity-capacity-value')).toHaveClass(/red-bg/);

    await expect(page.locator('#activity-preorder')).toBeHidden();
    const notification = page.locator('#activity-full-notification');
    await expect(notification).toBeVisible();
    await expect(notification).toContainText('This activity is full.');
    await expect(notification.locator('#waitlist-student-btn')).toBeVisible();
    await expect(notification.locator('#waitlist-student-btn')).toHaveText('Add to Waitlist');
  });

  test('WooCommerce product page shows the less-loaded clinic day as full too', async ({ page }) => {
    const family = uniqueFamilyDetails();
    await createFamily(page, family);

    const student = {
      firstName: 'Observer',
      lastName: family.lastName,
      birthdate: '2015-06-01',
      level: 'Beginner',
    };
    await createStudent(page, student);

    await switchToUser(page, family.email);

    await page.goto('/product/test-clinic/');
    await page.locator('#days-per-week').selectOption('One');
    await selectFromSelect2(page, 'student_select', student.firstName);
    // The storefront's day label is built from day_of_week/start_time
    // directly (add_day_selector() in usctdp-mgmt-product.js), not from
    // this activity's `title`/`search_term` columns - "Wednesday" matches
    // regardless of what those were set to above.
    await selectFromSelect2(page, 'day_of_week_1', 'Wednesday');

    const daySelector = page.locator('.usctdp-day-selector').first();
    await expect(daySelector.locator('.usctdp-day-status')).toBeVisible();
    await expect(daySelector.locator('.usctdp-full-message')).toHaveText('This class is full.');
    const waitlistBtn = daySelector.locator('.add-waitlist-btn');
    await expect(waitlistBtn).toBeVisible();
    await expect(waitlistBtn).toHaveText('Add to Waitlist');
    await expect(waitlistBtn).toBeEnabled();

    // updateCartAvailability() blocks the add-to-cart button too, whenever
    // any currently-selected day is full.
    await expect(page.locator('.single_add_to_cart_button')).toHaveClass(/usctdp-cart-disabled/);
  });
});
