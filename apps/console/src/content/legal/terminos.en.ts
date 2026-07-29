import type { DocumentoLegal } from './tipos';

/**
 * TERMS OF SERVICE, English version. Final text, reviewed and validated by counsel.
 *
 * Faithful translation of terminos.es.ts. The Spanish version is the one that governs. Section 7
 * (collective learning) must say exactly the same as the secondary purpose in the privacy notice; if you
 * edit one, edit all four files in the same commit.
 */
export const TERMINOS_EN: DocumentoLegal = {
  tipo: 'terms',
  version: '2026-07-29',
  fecha: 'July 29, 2026',
  titulo: 'Terms of Service',
  subtitulo:
    'The rules of the agreement between you and Ledesma AI Labs for using the platform: what we give you, what is on you, and what happens when something goes wrong.',
  secciones: [
    {
      id: 'aceptacion',
      titulo: '1. Acceptance of these terms',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'These Terms of Service are an agreement between you, as a user, and Omar Ledesma, an individual with business activity, operating under the trade name Ledesma AI Labs, located in Monterrey, Nuevo Leon, Mexico. Incorporation of the legal entity is in progress; once incorporated, these terms will be updated.',
        },
        {
          tipo: 'parrafo',
          texto:
            'By accepting these terms and the Privacy Notice on the platform, you agree to be bound by both. If you do not agree, you may not use the service. You must be of legal age and have the capacity to enter into this agreement. If you accept on behalf of a company, you represent that you have authority to bind it.',
        },
      ],
    },
    {
      id: 'servicio',
      titulo: '2. Description of the service',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Ledesma AI Labs is a platform that lets you build and operate artificial intelligence agents that carry out tasks for you, including navigating and acting inside third party websites where you have previously signed in.',
        },
        {
          tipo: 'lista',
          items: [
            'You connect a site by signing in yourself in a live browser view; the platform inherits that session context and stores it encrypted.',
            'You assign tasks to an agent in natural language, or you teach it a procedure by performing it once so it becomes a reusable recipe.',
            'You define an execution policy that determines what the agent may do on its own and what requires your explicit authorization before it runs.',
            'You review the history of what was executed, with its step by step trajectory and the screenshots from approval checkpoints.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'The service is provided as it currently stands and it evolves. We may add, change or withdraw functionality. When a change substantially reduces what the service offers you, we will endeavour to give you reasonable advance notice.',
        },
      ],
    },
    {
      id: 'cuenta',
      titulo: '3. Your account',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'You are responsible for keeping your access credentials confidential and for all activity that occurs under your account. You must give us accurate information when you register and keep it up to date. Tell us immediately at contacto@ledesma-ai-labs.com if you detect unauthorized use of your account.',
        },
        {
          tipo: 'parrafo',
          texto:
            'You may delete your account at any time from settings. Doing so erases your data as described in the Privacy Notice.',
        },
      ],
    },
    {
      id: 'byok',
      titulo: '4. BYOK scheme and your third party accounts',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'The platform operates under a BYOK scheme, meaning you supply your own API key for the artificial intelligence provider you choose. This has consequences worth being clear about:',
        },
        {
          tipo: 'lista',
          items: [
            'The contractual relationship with that model provider is yours, not ours. Your use of it is also governed by that provider terms and privacy notice, which it is up to you to read and comply with.',
            'The consumption your tasks generate with that key is billed to your account with that provider, and that cost is yours. We neither control it nor reimburse it.',
            'You are responsible for safeguarding your key, rotating it when appropriate and revoking it if you suspect it was compromised. We store it encrypted and never display it back, but you decide when to add it and when to remove it.',
            'You are responsible for the third party accounts you connect to the platform and for having the right to use them this way. Check that automating access to those accounts does not breach the terms of the site in question.',
            'If a third party site blocks, suspends or cancels your account because of your use of automated agents, that consequence is yours. We cannot reverse it and are not answerable for it.',
          ],
        },
      ],
    },
    {
      id: 'uso-aceptable',
      titulo: '5. Acceptable use',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Agents act on your instruction and under your responsibility. By using the platform you undertake not to use it to:',
        },
        {
          tipo: 'lista',
          items: [
            'Carry out or facilitate any activity that is unlawful under Mexican law or under the law applicable to you.',
            'Access systems, accounts or data you are not authorized to access, or circumvent access controls, authentication or identity verification.',
            'Send unsolicited bulk communications or any other form of spam, or artificially inflate metrics, votes, reviews or engagement.',
            'Operate in breach of the terms of service, the robots exclusion file or the technical limits of the third party sites where you connect your accounts.',
            'Impersonate any person or organization, or generate or spread misleading or defamatory content, or content that infringes third party rights.',
            'Harvest third party personal data in bulk, or build profiles of individuals without a legal basis for doing so.',
            'Attempt to breach, overload or reverse engineer the platform, or evade its usage limits, quotas or security mechanisms.',
            'Resell the service or allow access to it by unauthorized third parties, absent a written agreement with us.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'We may suspend or terminate your access immediately and without refund if we detect use that breaches this section or that puts the platform, other users or third parties at risk. Where circumstances allow, we will notify you and give you an opportunity to correct it.',
        },
      ],
    },
    {
      id: 'propiedad',
      titulo: '6. Intellectual property',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'The platform, its software, architecture, interface, documentation, trademarks and distinctive signs are owned by Ledesma AI Labs or its licensors and are protected by applicable law. These terms grant you a limited, revocable, non exclusive and non transferable license to use the service as agreed here. No other right is transferred to you.',
        },
        {
          tipo: 'parrafo',
          texto:
            'The content you provide (your instructions, your files, your configurations, your recipes and the results of your tasks) remains yours. You grant us only the license needed to host it, process it and display it to you in order to provide the service, and for the aggregated structural learning purpose described in the next section. That license ends when you delete the content or your account.',
        },
        {
          tipo: 'parrafo',
          texto:
            'If you send us product feedback or suggestions, we may use them to improve the product with no obligation to compensate you and without granting you rights over the result.',
        },
      ],
    },
    {
      id: 'aprendizaje-colectivo',
      titulo: '7. Collective learning',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'So the platform works more reliably for everyone, we may learn from the STRUCTURE of the websites where tasks are executed and aggregate that learning into a shared repository. This clause corresponds to the secondary purpose declared in the Privacy Notice and has exactly the same scope described there.',
        },
        {
          tipo: 'parrafo',
          texto: 'What is aggregated, and nothing beyond this:',
        },
        {
          tipo: 'lista',
          items: [
            'The website domain.',
            'The type or class of the element that was interacted with, for example a search field or a submit button.',
            'The strategy that worked to locate that element within the page.',
          ],
        },
        {
          tipo: 'parrafo',
          texto: 'What is never aggregated:',
        },
        {
          tipo: 'lista',
          items: [
            'The content of the pages the agent read.',
            'The values typed into forms.',
            'Your goals, your instructions, or any personal data of yours or of third parties.',
            'Any credential, token or session context.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Origin identifiers are converted into derived values through a one way cryptographic function, so aggregated learning cannot be tied back to you or to your account. You may object to this purpose at any time by writing to contacto@ledesma-ai-labs.com, and doing so will not affect your use of the service.',
        },
      ],
    },
    {
      id: 'planes',
      titulo: '8. Plans, limits and payments',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'The service is offered in different plans, each with associated usage limits. Current limits and their scope are shown in the platform. Once your plan limit is exhausted, running new tasks may be restricted until the period renews or until you change plans.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Remember that consumption with your model provider is independent of your platform plan and is billed separately, directly to your account with that provider, as set out in section 4.',
        },
      ],
    },
    {
      id: 'garantias',
      titulo: '9. No warranties',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'The service is provided as is and as available. To the extent permitted by law, we make no warranty that the service will be uninterrupted or error free, or that an agent will correctly complete any given task.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Artificial intelligence systems can make mistakes, misread an instruction or act on the wrong element of a page. That is why the platform gives you an execution policy and approval checkpoints: use them. Review results before relying on them, and reserve unsupervised execution for tasks whose potential error you can absorb.',
        },
      ],
    },
    {
      id: 'responsabilidad',
      titulo: '10. Limitation of liability',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'To the maximum extent permitted by applicable law, Ledesma AI Labs will not be liable for indirect, incidental, special or consequential damages, nor for lost profits, data loss, lost business opportunities or reputational harm, arising from the use of or inability to use the service.',
        },
        {
          tipo: 'parrafo',
          texto:
            'In particular, we are not liable for the consequences of actions an agent performs following your instructions and within the execution policy you configured, nor for decisions you make based on the results it produces, nor for the blocking or cancellation of your accounts on third party sites.',
        },
        {
          tipo: 'parrafo',
          texto:
            'Our total aggregate liability, on any ground, will not exceed the amount you paid us for the service in the three months preceding the event giving rise to the claim. Nothing in this section limits liabilities that the law does not permit to be limited, including those arising from wilful misconduct or gross negligence.',
        },
        {
          tipo: 'parrafo',
          texto:
            'You agree to hold us harmless from third party claims arising from your use of the service in breach of these terms or of the law.',
        },
      ],
    },
    {
      id: 'terminacion',
      titulo: '11. Term and termination',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'These terms apply for as long as you use the service. You may terminate them at any time by deleting your account. We may suspend or terminate your access under section 5, or upon discontinuing the service, giving you reasonable advance notice where circumstances allow. The sections on intellectual property, no warranties, limitation of liability and jurisdiction survive termination.',
        },
      ],
    },
    {
      id: 'cambios',
      titulo: '12. Changes to these terms',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'These terms are versioned. When we change them we will publish the new version at this same address, with its version number and date, and the platform will ask you to accept it the next time you sign in: without that acceptance you will not be able to keep using the service. You can review in the privacy section of your account which version you accepted and on which date.',
        },
      ],
    },
    {
      id: 'jurisdiccion',
      titulo: '13. Governing law and jurisdiction',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'These terms are governed by the laws of the United Mexican States. For the interpretation and performance of this agreement, the parties submit to the jurisdiction of the competent courts of Monterrey, Nuevo Leon, Mexico, waiving any other venue that may correspond to them by reason of their present or future domicile, save for any consumer protection rights that the law grants you and that cannot be waived.',
        },
      ],
    },
    {
      id: 'contacto',
      titulo: '14. Contact',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'For any question about these terms, write to us at contacto@ledesma-ai-labs.com or visit https://www.ledesma-ai-labs.com. These terms correspond to version 2026-07-29, dated July 29, 2026.',
        },
      ],
    },
  ],
};
