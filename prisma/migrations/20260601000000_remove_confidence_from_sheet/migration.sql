-- Strip confidence key from existing character sheets
UPDATE "characters"
SET sheet = sheet - 'confidence'
WHERE sheet ? 'confidence';
