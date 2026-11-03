# Stix research thesis automatic intake

Standing user direction (November 2, 2026): **Do not require the user to ask to add new theses.** Whenever a conversation in the Stix project raises a concrete, testable hypothesis about NFL props, model features, selection criteria, signal filters, usage, weather, pricing, ROI, or a proposed predictive improvement, treat it as an implicit request to register the thesis. This also applies to follow-up proposals and refinements.

When operating with authorized GitHub access:
1. Read `data/challenger/theses.json` on the current `main` branch.
2. Check whether the hypothesis is already represented; append a new `TH-###` entry for a distinct question or create a separately versioned hypothesis for a material definition change. Never silently overwrite an existing test definition.
3. Record a short clear title, falsifiable question, origin date, proposed scope and data needs, metric source when implemented, and honest status. Use `needs_data` unless a genuine forward test exists. Note discovery vs prospective evidence explicitly.
4. Commit the registry update via a PR or authorized direct commit, without waiting for another explicit “add it” prompt. Do not change the frozen T12/T13 model or launch API-costly collection solely by registering an idea.
5. Acknowledge registration and the new ID in the natural answer; if GitHub is not available, be explicit that registration hasn't occurred and supply the intended entry rather than claiming success.
6. The normal Wednesday reporting workflow compiles all registered entries. It does *not* discover and ingest conversations independently of an assistant invocation.
7. The Results-tab registry panel is restricted to verified Stix admins through the existing admin RPC. The public static site payload itself is not a secure boundary; sensitive unpublished thesis content must move to a server-side admin-authorized data source before confidentiality can be promised.

Examples: question about median vs mean => register; proposed QB rushing under threshold => register; competing game-script interaction => register. Simple explanations of how an existing method works, or repeating the same idea, do not create duplicate registry entries.

This document guides agents executing in the repository; it does not automatically inject an instruction into every future ChatGPT project conversation. Project-level custom instructions (where supported) should mirror this policy for dependable intake across new chats.
