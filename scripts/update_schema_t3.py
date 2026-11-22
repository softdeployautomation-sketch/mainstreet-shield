import re

with open('prisma/schema.prisma', 'r') as f:
    content = f.read()

# 1. Add details field to CompanyAsset (after inScope line, before notes)
old = '  inScope     Boolean  @default(true)\n  notes       String?'
new = '  inScope     Boolean  @default(true)\n  details     String?  // T-3.3: free-text details (notes, credentials hints, misconfigurations)\n  notes       String?'
if old in content:
    content = content.replace(old, new, 1)
    print('Added details field to CompanyAsset')
else:
    print('ERROR: Could not find CompanyAsset inScope/notes block')

# 2. Add reportDocumentId to CompanyAssetGroup (after name, before createdAt)
old2 = '  name      String\n  createdAt DateTime @default(now())\n\n  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)\n  assets  CompanyAsset[]\n\n  @@index([companyId])\n}'
new2 = '  name      String\n  reportDocumentId String?  // T-3.2: linked ReportDocument for scan history\n  createdAt DateTime @default(now())\n\n  company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)\n  assets  CompanyAsset[]\n  reportDocuments ReportDocument[]\n\n  @@index([companyId])\n}'
if old2 in content:
    content = content.replace(old2, new2, 1)
    print('Added reportDocumentId + reportDocuments to CompanyAssetGroup')
else:
    print('ERROR: Could not find CompanyAssetGroup block')

# 3. Add ReportDocument model after CompanyAssetGroup
old3 = '  @@index([companyId])\n}\n\n// ---------------------------------------------------------------------------\n// Workflows — test workflows humans can create and run'
new3 = '''  @@index([companyId])
}

// ---------------------------------------------------------------------------
// ReportDocument — scan history + findings per asset group (T-3.2)
// ---------------------------------------------------------------------------
model ReportDocument {
  id          String   @id @default(cuid())
  groupId     String
  title       String   // e.g. "Scan results for web group - 2026-11-21"
  content     String   // markdown: scan process, findings, timestamps, decisions
  version     Int      @default(1)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  group CompanyAssetGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@index([groupId])
}

// ---------------------------------------------------------------------------
// Workflows — test workflows humans can create and run'''
if old3 in content:
    content = content.replace(old3, new3, 1)
    print('Added ReportDocument model')
else:
    print('ERROR: Could not find insertion point for ReportDocument model')

with open('prisma/schema.prisma', 'w') as f:
    f.write(content)

print('Done with schema changes')