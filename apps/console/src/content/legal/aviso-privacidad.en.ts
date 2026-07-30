import type { DocumentoLegal } from './tipos';

/**
 * PRIVACY NOTICE, English version. Final text, reviewed and validated by counsel.
 *
 * Faithful translation of aviso-privacidad.es.ts. The Spanish version is the one that governs under
 * Mexican law; this one exists so users outside Mexico can read the same commitments. If you edit one,
 * edit the other in the same commit: the version string is shared and a mismatch would publish two
 * different documents under one version number.
 */
export const AVISO_PRIVACIDAD_EN: DocumentoLegal = {
  tipo: 'privacy_notice',
  version: '2026-07-30',
  fecha: 'July 30, 2026',
  titulo: 'Privacy Notice',
  subtitulo:
    'How we process your personal data on the Ledesma AI Labs platform, what we do with it, and how you stay in control of it.',
  secciones: [
    {
      id: 'responsable',
      titulo: '1. Identity and address of the data controller',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'Omar Ledesma, an individual with business activity, operating under the trade name Ledesma AI Labs, is the controller responsible for processing your personal data. Incorporation of the legal entity is in progress; once incorporated, this notice will be updated and you will be asked to accept the new version.',
        },
        {
          tipo: 'definiciones',
          items: [
            { termino: 'Trade name', descripcion: 'Ledesma AI Labs' },
            {
              termino: 'Controller',
              descripcion:
                'Omar Ledesma, an individual with business activity, operating under the trade name Ledesma AI Labs',
            },
            { termino: 'Location', descripcion: 'Monterrey, Nuevo Leon, Mexico' },
            { termino: 'Operations began', descripcion: '2026' },
            {
              termino: 'Contact address, also for data subject rights',
              descripcion: 'contacto@ledesma-ai-labs.com',
            },
            { termino: 'Website', descripcion: 'https://www.ledesma-ai-labs.com' },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'This notice is issued under the Mexican Federal Law on the Protection of Personal Data Held by Private Parties published in March 2025, which repealed the 2010 law, and its applicable regulations. We also apply international good practice principles (data minimization, purpose limitation and portability) because the platform may have users outside Mexico. The Spanish version of this notice is the one that governs.',
        },
      ],
    },
    {
      id: 'datos',
      titulo: '2. Personal data we process and where it comes from',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'We obtain all the data we process directly from you, when you create your account, configure the platform or use it. We do not buy or otherwise acquire personal data from third parties or from publicly available sources.',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Identification and account data',
              descripcion:
                'Email address, full name, account type (individual or company), role, organization name where applicable, country of operation, plan, and creation and update timestamps. Your password lives exclusively in the Supabase authentication system, in encrypted form; it never reaches our tables and we cannot read it.',
            },
            {
              termino: 'Model provider credentials (BYOK scheme)',
              descripcion:
                'The API key of the artificial intelligence provider that you supply, together with a label you choose and, where applicable, the base URL of the service. The key is always stored encrypted with AES-256-GCM and is never displayed back in the interface.',
            },
            {
              termino: 'Session context for the sites you connect',
              descripcion:
                'When you connect a site, you sign in yourself in a live browser view and the platform inherits that session context (browser cookies and storage). That context is always stored encrypted with AES-256-GCM. We also store the site domain, the connection status, the egress country pinned to that connection and, for observability purposes, the egress IP address of the remote browser session.',
            },
            {
              termino: 'Web task trajectories',
              descripcion:
                'For each run of the navigation engine we record the domain, the goal you wrote in natural language, the outcome, the duration and the tokens consumed. For each action we record the action type, the instruction, the element location strategy, the address where it happened and the value typed, already redacted. Redaction runs before anything is written to the database: values from sensitive fields (passwords, cards, tokens) never reach our records.',
            },
            {
              termino: 'Screenshots at approval checkpoints',
              descripcion:
                'When a task pauses to ask for your authorization before a significant action, we store a screenshot of what the agent was seeing at that moment, along with the description of the action and your decision. Screenshots live in private storage with per user access control.',
            },
            {
              termino: 'Task recordings and recipes',
              descripcion:
                'When you teach the platform a task by performing it yourself once, we store the steps of that procedure. Sign in is never recorded: if a password field appears during a recording, capture stops, whatever was captured is discarded and the recording is marked as discarded. When a recording becomes a recipe, the values you mark as variable are replaced by a placeholder and the concrete value is resolved on each run.',
            },
            {
              termino: 'Execution and usage data',
              descripcion:
                'Status of each task, timestamps, tokens consumed and estimated cost, errors and metadata of your agent runs. These let you review your activity, support billing and help diagnose failures.',
            },
            {
              termino: 'Content you send to the agents',
              descripcion:
                'The messages you write in the configurator or the playground, the files you attach (from which text is extracted to give to the model) and, if you use voice dictation, the audio you record for transcription. The audio is sent to the transcription service and is not retained; the transcribed text is returned to you so you can review it before sending.',
            },
            {
              termino: 'Keystrokes from the mobile relay',
              descripcion:
                'If you use your phone as a keyboard to type inside a browser session, the text you type travels encrypted from your device to the relay service. That text is not stored: it is only forwarded to the browser session. Section 8 states precisely how far that encryption reaches.',
            },
            {
              termino: 'Evidence of your legal acceptances',
              descripcion:
                'Which document you accepted, at which version, the date and time, and a value derived from your IP address through a one way cryptographic function. We do not retain your IP address in the clear alongside that acceptance: the derived value cannot be reversed.',
            },
            {
              termino: 'Rights requests and compliance records',
              descripcion:
                'The data subject rights requests you send us, their status and their resolution, as well as the record of processing activities associated with your agents.',
            },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'We do not request sensitive personal data, and the platform is not designed to process it. If you choose to connect a site or run tasks on services where sensitive data about you or about third parties exists, that decision and its consequences are yours: review the responsibilities section of the Terms of Service before doing so.',
        },
      ],
    },
    {
      id: 'finalidades-primarias',
      titulo: '3. Primary purposes (necessary to provide the service)',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'These purposes are necessary for our contractual relationship with you. If you object to them, we cannot provide the service.',
        },
        {
          tipo: 'lista',
          items: [
            'Authenticate you and manage your account, your organization and your plan.',
            'Store, encrypted, the model provider credentials you supply and use them to run the tasks you order.',
            'Store, encrypted, the session contexts of the sites you connect, so those sessions can be resumed when running your tasks.',
            'Run on your behalf the tasks you order inside the sites you connected, including automated navigation, typing into forms and reading the pages needed to complete the task.',
            'Pause a task and ask for your explicit authorization before significant actions, showing you the description and a screenshot of what the agent was seeing.',
            'Keep an activity history (tasks, trajectories, approvals and consumption) so you can review it, audit it and diagnose failures.',
            'Learn from the tasks you teach or that your agents complete, in order to turn them into reusable recipes inside YOUR account.',
            'Measure your consumption, apply your plan limits and bill you where applicable.',
            'Handle your support requests and your rights requests, and retain evidence of your legal acceptances.',
            'Comply with applicable legal obligations and respond to requests from a competent authority.',
          ],
        },
      ],
    },
    {
      id: 'finalidades-secundarias',
      titulo: '4. Secondary purposes (not necessary, you may object)',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'These purposes are not necessary to provide the service. You may object to them at any time by writing to contacto@ledesma-ai-labs.com, and doing so will not affect your use of the platform.',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Aggregated structural learning about websites',
              descripcion:
                'Improving the reliability of the service for every user by learning how websites are built. What gets aggregated is structure only: the site domain, the type of element that was interacted with (for example, a search field or a submit button) and the strategy that worked to locate that element on the page. Page contents, the values you typed, the text you read and any personal data are never aggregated, and origin identifiers are converted into derived values through a one way cryptographic function, so the learned structure cannot be tied back to you. This purpose is in operation: the platform aggregates structure from the websites where tasks are executed, with the scope described above and no wider.',
            },
            {
              termino: 'Operational alerts and service emails',
              descripcion:
                'Sending you welcome messages, service status notices and operational alerts about your account by email.',
            },
          ],
        },
      ],
    },
    {
      id: 'decisiones-automatizadas',
      titulo: '5. Artificial intelligence agents and automated decisions',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'The platform runs artificial intelligence agents that act autonomously inside the sites you connect: they navigate, read pages, type into forms and perform actions to complete the task you assigned them. You are interacting with an automated system, not with a person.',
        },
        {
          tipo: 'parrafo',
          texto:
            'You control the scope of that autonomy through your execution policy, and the platform pauses the task and asks for your explicit authorization before significant actions, showing you what it is about to do and a screenshot of what the agent sees. Your decision is recorded. At any moment you can stop a running task, disconnect a site or revoke your model provider credential.',
        },
        {
          tipo: 'parrafo',
          texto:
            'If you believe an automated decision produces a significant effect on you, you may request human intervention and object to it by writing to contacto@ledesma-ai-labs.com.',
        },
      ],
    },
    {
      id: 'transferencias',
      titulo: '6. Processors and transfers',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'We do not sell your personal data and we do not share it for commercial purposes. To operate the platform we rely on the following providers, which act as processors and handle data solely under our instructions and under their own terms:',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Supabase (United States)',
              descripcion:
                'Authentication, database and file storage. Your account, your data tables and the approval checkpoint screenshots live here.',
            },
            {
              termino: 'Railway (United States)',
              descripcion:
                'Hosting for the backend services, the navigation worker and the relay service.',
            },
            {
              termino: 'Vercel (United States)',
              descripcion: 'Hosting and delivery of the platform web interface.',
            },
            {
              termino: 'Browserbase (United States)',
              descripcion:
                'Provision of the remote browsers where your sessions and web tasks run, including internet egress through the region pinned to each connection.',
            },
            {
              termino: 'The model provider you choose, under the BYOK scheme',
              descripcion:
                'Anthropic (United States), OpenAI (United States) or another compatible provider you configure. Under the BYOK scheme you supply your own API key and the relationship with that provider is yours: the content sent to it is also governed by that provider terms and privacy notice, which it is up to you to review. We do not choose that provider for you and we cannot change its policies.',
            },
            {
              termino: 'OpenAI (United States), for voice dictation',
              descripcion:
                'If you use voice dictation, the audio is sent to this service for transcription. This feature uses a platform key, not yours, and it is optional: if you do not dictate by voice, no audio is sent anywhere.',
            },
            {
              termino: 'Resend (United States)',
              descripcion:
                'Delivery of platform emails (welcome and operational alerts). It receives your email address and the message content.',
            },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'Because these providers operate from abroad, using the platform involves an international transfer of data that is necessary to provide the service you requested. Beyond the transfers above, we may disclose data when required by a competent authority or by law.',
        },
      ],
    },
    {
      id: 'conservacion',
      titulo: '7. Retention periods and purging',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'We keep each piece of data only as long as its purpose requires. These are the periods the platform implements today:',
        },
        {
          tipo: 'definiciones',
          items: [
            {
              termino: 'Web task trajectories and their steps: 30 days',
              descripcion:
                'This is deliberately the shortest period, because even with values redacted the steps describe your activity inside your sites.',
            },
            {
              termino: 'Finished tasks: 90 days from completion',
              descripcion:
                'Only tasks in a terminal state are purged. Pending or running tasks are never touched.',
            },
            {
              termino: 'Agent run metadata: 365 days',
              descripcion:
                'This is usage metadata (without message content), and a year lets you review your annual consumption before it is purged.',
            },
            {
              termino: 'Keyboard relay coordination: minutes',
              descripcion:
                'Coordination records live for a window of at most fifteen minutes and a sweep removes them every ten minutes.',
            },
            {
              termino:
                'Account, encrypted credentials, connected sites and recipes: while you have an account',
              descripcion:
                'These are kept while the relationship is active. They are removed when you delete them or when you delete your account.',
            },
            {
              termino:
                'Evidence of legal acceptances: while you have an account, and afterwards as needed',
              descripcion:
                'This is the proof of your consent and is kept while it may be enforceable. It is deleted when you delete your account.',
            },
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'When you delete your account we erase, in a single operation that either completes fully or does not run at all, all of your business data: agents, runs, tasks, recipes, encrypted credentials, connected sites with their encrypted contexts, trajectories, legal acceptances, rights requests, subscription and profile. Administrative action logs are kept without being linkable to you, so operational traceability is preserved. Where references exist to contexts living at the remote browser provider, they are collected so they can be purged on that side as well.',
        },
      ],
    },
    {
      id: 'seguridad',
      titulo: '8. Security measures',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'We apply the following measures, described precisely so you know exactly what they protect and what they do not. We hold no third party security certifications, and we do not claim to.',
        },
        {
          tipo: 'lista',
          items: [
            'The model provider credentials you supply are stored encrypted with AES-256-GCM under a master secret that lives only in the server environment, and are never returned to the interface.',
            'The session contexts of the sites you connect are stored encrypted with AES-256-GCM under that same scheme, in a binary column, and are only decrypted in memory while running one of your tasks.',
            'Per user isolation at every layer: every database query is scoped by the data subject identifier taken from the session token, and tables additionally carry row level security policies that only allow reading your own rows. Writes of sensitive data always happen server side.',
            'The internet egress country is pinned to each site you connect, and a task aborts if the session egresses through a country other than the pinned one.',
            'Values the agent types pass through redaction before being stored: passwords, cards and tokens never reach the trajectory or recording records. Sign in is never recorded.',
            'Approval checkpoint screenshots live in private, non public storage with per user access control.',
            'Evidence of your legal acceptances does not store your IP address: it stores a value derived through a one way cryptographic function with a server secret.',
            'Your password lives exclusively in the Supabase authentication system, encrypted; it never reaches our tables.',
          ],
        },
        {
          tipo: 'parrafo',
          texto:
            'On the mobile keyboard relay, precisely: the text you type from your phone travels encrypted from your device to the relay service, with an ephemeral per session key exchange and authenticated encryption. That protects the text from the proxy that terminates the secure connection and from platform logs, which never see it in the clear. However, the remote browser where the text is typed does receive it in the clear, because it has to type it into the page. In other words: the encryption protects the journey, not the destination. We do not claim this is end to end encryption all the way to the destination site, because it is not.',
        },
        {
          tipo: 'parrafo',
          texto:
            'No security measure is absolute. Should a breach occur that significantly affects your rights, we will inform you so you can take action.',
        },
      ],
    },
    {
      id: 'derechos',
      titulo: '9. Your rights, withdrawal of consent and portability',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'You have the right to access your personal data, to rectify it when it is inaccurate or incomplete, to cancel it when you believe it is not required for the purposes in this notice, and to object to its processing for specific purposes. You may also withdraw your consent at any time and request your data in a portable format.',
        },
        {
          tipo: 'parrafo',
          texto:
            'You can exercise these rights in two ways. First, from the platform itself, in the privacy section of your account, where you can submit your request, track its status and download your data. Second, by writing to contacto@ledesma-ai-labs.com. In both cases we need to be able to verify your identity and you need to tell us clearly which data you want to access, rectify or cancel, or which processing you object to; if you request a rectification, include the documentation that supports the change.',
        },
        {
          tipo: 'parrafo',
          texto:
            'We will answer your request within the periods set by applicable law, communicating the determination reached and, where appropriate, giving effect to it within the legal deadline. If you are not satisfied with our response, or if you receive none, you may turn to the competent data protection authority, which since the dissolution of INAI is the Secretaria Anticorrupcion y Buen Gobierno.',
        },
        {
          tipo: 'parrafo',
          texto:
            'In addition, you can limit the use of your data yourself at any time: delete a model provider credential, disconnect a site, delete a task or a recipe, stop a running task, or delete your account entirely from settings. Withdrawing consent for the primary purposes means we can no longer provide the service.',
        },
      ],
    },
    {
      id: 'cambios',
      titulo: '10. Changes to this notice',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'This notice is versioned. When we change it we will publish the new version at this same address, with its version number and date, and the platform will ask you to accept it the next time you sign in: without that acceptance you will not be able to keep using the service. That way you learn about the change at the moment it affects you, rather than in an email that gets lost. When a change is substantive we will also notify the email address on your account.',
        },
        {
          tipo: 'parrafo',
          texto:
            'You can review in the privacy section of your account which documents you accepted, at which version and on which date.',
        },
      ],
    },
    {
      id: 'contacto',
      titulo: '11. Contact',
      bloques: [
        {
          tipo: 'parrafo',
          texto:
            'For any question about this notice or about the processing of your personal data, write to us at contacto@ledesma-ai-labs.com. This notice corresponds to version 2026-07-30, dated July 30, 2026.',
        },
      ],
    },
  ],
};
