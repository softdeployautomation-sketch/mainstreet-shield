with open('lib/clin/cline-session.ts', 'r') as f:
    content = f.read()

# Add decide_scan_target before the closing ];
# Find the specific occurrence right after "return { ok: true, asset: updated };"
old = '        return { ok: true, asset: updated };\n      },\n    },\n  ];\n};'

new_tool = '''        return { ok: true, asset: updated };
      },
    },

    // T-3.1: Scan decision logic
    {
      name: "decide_scan_target",
      description:
        "Analyze existing in-scope assets and recommend a scan target and type. Input: {}. Returns { recommendedTarget, recommendedScanType, recommendedGoal, reasoning, availableAssets: [{ id, name, type, target, groupId }] }. Use this before starting any scan to decide what to scan and why.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const company = await db.company.findUnique({
          where: { userId },
          include: {
            assets: {
              where: { inScope: true },
              orderBy: { createdAt: "desc" },
            },
          },
        });
        if (!company) {
          return { error: "company_not_found" };
        }

        const assets = company.assets ?? [];
        const availableAssets = assets.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          target: a.target,
          groupId: a.groupId,
        }));

        if (assets.length === 0) {
          return {
            action: "no_in_scope_assets",
            message: "Create in-scope assets first before scanning",
            availableAssets: [],
          };
        }

        const hasWeb = assets.some((a) => a.type === "web");
        const hasIP = assets.some((a) => a.type === "network" || /^\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}$/.test(a.target));
        const recommendedTarget = assets[0].target;

        let recommendedScanType: string;
        let recommendedGoal: string;
        let reasoning: string;

        if (hasWeb && !hasIP) {
          recommendedScanType = "web";
          recommendedGoal = "discover subdomains, open ports, services, and potential entry points on " + recommendedTarget;
          reasoning = "Only website-type assets exist. Recommend a web scan to discover subdomains, open ports, services, and entry points.";
        } else if (hasIP && !hasWeb) {
          recommendedScanType = "network";
          recommendedGoal = "enumerate services, OS, vulnerabilities, and admin access on " + recommendedTarget;
          reasoning = "IP-type assets exist. Recommend a network scan to enumerate services, OS, vulnerabilities, and admin access.";
        } else {
          recommendedScanType = "full";
          recommendedGoal = "comprehensive reconnaissance and exploitation on " + recommendedTarget;
          reasoning = "Mixed web and IP assets exist. Recommend a full scan for comprehensive reconnaissance and exploitation.";
        }

        return {
          recommendedTarget,
          recommendedScanType,
          recommendedGoal,
          reasoning,
          availableAssets,
        };
      },
    },
  ];
};'''

if old in content:
    content = content.replace(old, new_tool, 1)
    print('Added decide_scan_target')
else:
    print('ERROR: Could not find target text')
    idx = content.find('  ];')
    if idx >= 0:
        print('Found ]; at', idx)
        print(repr(content[idx-200:idx+20]))

with open('lib/clin/cline-session.ts', 'w') as f:
    f.write(content)

print('Done')