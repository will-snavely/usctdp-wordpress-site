import { test } from '@playwright/test';
import { createFamily, createStudent, uniqueFamilyDetails } from './helpers';

test('creates a student within a family via the admin UI', async ({ page }) => {
  const family = uniqueFamilyDetails();
  await createFamily(page, family);

  await createStudent(page, {
    firstName: 'Junior',
    lastName: family.lastName,
    birthdate: '2015-06-01',
    level: 'Beginner',
  });
});
