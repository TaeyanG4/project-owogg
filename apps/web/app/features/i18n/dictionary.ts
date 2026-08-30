import type { SupportedLocale } from "@owogg/contracts";

/** Keys covered so far: global navigation (header/footer), the language selector itself, and
 * common loading/error/empty states. This is a real, working i18n foundation — translating every
 * remaining screen (games/ranking/profile/discord/admin/wiki body copy) is deliberately left for
 * a follow-up session (see docs/I18N.md and docs/WORK_PROGRESS.md) rather than rushed here. */
export interface Dictionary {
  common: {
    loading: string;
    error: string;
    retry: string;
    empty: string;
    save: string;
    cancel: string;
  };
  nav: {
    searchPlaceholder: string;
    favorites: string;
    login: string;
    logout: string;
    myProfile: string;
    settings: string;
    ranking: string;
    wiki: string;
    /** Appended after the provider name in the header's connected-providers badges, e.g.
     * "google" + this = "google account". */
    accountSuffix: string;
  };
  /** Left nav rail (desktop icon-strip with an explicit hover-revealed expand control) and its
   * mobile drawer equivalent. The mobile drawer always shows full label text. */
  sidebar: {
    openMenuAria: string;
    expandMenuAria: string;
    collapseMenuAria: string;
    mobileMenuTitle: string;
    home: string;
    allGames: string;
    popularGames: string;
    rankingRecords: string;
    /** Divider label between the game-related nav group and everything else (Discord hub,
     * changelog) — games always come first, this heading marks where "the rest" starts. */
    otherHeading: string;
    discordHub: string;
    /** Divider label above the drawer's secondary actions (favorites/Discord servers/language) —
     * the items narrow phones can't fit in the header itself. See Header.tsx's comment for why
     * this split exists. */
    moreHeading: string;
    favorites: string;
    discordServers: string;
  };
  footer: {
    tagline: string;
    allGames: string;
    ranking: string;
    wiki: string;
    changelog: string;
    contactUs: string;
    rightsReserved: string;
  };
  home: {
    heroEyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    browseGames: string;
    lineupTitle: string;
    itemsCountSuffix: string;
    popularTitle: string;
    recentPlaysTitle: string;
    favoritesTitle: string;
    emptyCategory: string;
    gridColumnsAriaPrefix: string;
    gridColumnsAriaSuffix: string;
    teaserTitle: string;
    teaserBody: string;
    teaserCta: string;
  };
  language: {
    label: string;
    ko: string;
    en: string;
    ja: string;
    zh: string;
  };
  loginModal: {
    title: string;
    subtitle: string;
    close: string;
    googleButton: string;
    googleLoading: string;
    googleUnconfigured: string;
    discordButton: string;
    discordLoading: string;
    discordUnconfigured: string;
    providerChecking: string;
    providerUnavailable: string;
    retry: string;
  };
  games: {
    eyebrow: string;
    title: string;
    countSuffix: string;
    searchPlaceholder: string;
    emptyFavorites: string;
    emptySearch: string;
    sortLabel: string;
    sortOptions: {
      popular: string;
      newest: string;
      players: string;
      bookmarks: string;
    };
    playerCountLabel: string;
    bookmarkCountLabel: string;
    categories: {
      all: string;
      popular: string;
      reaction: string;
      brain: string;
      aim: string;
      typing: string;
      favorites: string;
    };
    addFavoriteAriaPrefix: string;
    addFavoriteAriaSuffix: string;
    removeFavoriteAriaPrefix: string;
    removeFavoriteAriaSuffix: string;
  };
  ranking: {
    eyebrow: string;
    title: string;
    subtitle: string;
    gameTab: string;
    xpTab: string;
    streamerTab: string;
    allCategories: string;
    allPlatforms: string;
    platformChzzk: string;
    platformSoop: string;
    scoreMode: string;
    xpMode: string;
    streakMode: string;
    dailyPeriod: string;
    weeklyPeriod: string;
    monthlyPeriod: string;
    rankHeader: string;
    playerHeader: string;
    streamerHeader: string;
    countryHeader: string;
    categoryHeader: string;
    recordHeader: string;
    dateHeader: string;
    modeHeader: string;
    levelHeader: string;
    totalXpHeader: string;
    recordOrCategory: string;
    activityLevel: string;
    badgeHeader: string;
    platformHeader: string;
    emptyGames: string;
    emptyXp: string;
    emptyStreak: string;
    unknownCountry: string;
    emptyStreamerTitle: string;
    emptyStreamerBody: string;
    retryButton: string;
    rank1: string;
    rank2: string;
    rank3: string;
  };
  /** The SETTINGS page (/settings). Display-only profile content lives under `userProfile`
   * (/users/:id) — these two used to overlap heavily and were merged; this namespace keeps
   * only the sensitive/account-management side. */
  profile: {
    pageTitle: string;
    pageSubtitle: string;
    joinedLabel: string;
    viewProfileCta: string;
    logout: string;
    visibilityTitle: string;
    visibilitySubtitle: string;
    visibilityFavoritesLabel: string;
    visibilityRecentPlaysLabel: string;
    visibilityPublicOption: string;
    visibilityPrivateOption: string;
    visibilityUpdated: string;
    visibilityUpdateFailed: string;
    favoritesTitle: string;
    emptyFavorites: string;
    recentPlaysTitle: string;
    achievementsTitle: string;
    emptyAchievements: string;
    noRecordLabel: string;
    deviceRecordLabel: string;
    noRecordYetHint: string;
    justNow: string;
    minutesAgoSuffix: string;
    hoursAgoSuffix: string;
    daysAgoSuffix: string;
    linkSuccess: string;
    alreadyLinkedAccount: string;
    linkError: string;
    streamerVerifySuccess: string;
    streamerVerifyConflict: string;
    streamerVerifyUnconfigured: string;
    streamerVerifyUnauthorized: string;
    streamerVerifyError: string;
    googleScriptNotReady: string;
    googleLinkSuccess: string;
    googleAccountInUse: string;
    googleAlreadyLinked: string;
    googleLinkFailed: string;
    unlinkSuccessSuffix: string;
    lastAuthProviderError: string;
    unlinkFailed: string;
    mergeCompleted: string;
    nicknameUpdated: string;
    nicknameCooldownPrefix: string;
    nicknameCooldownSuffix: string;
    nicknameUpdateFailed: string;
    nicknamePolicyHint: string;
    nicknamePreviewLabel: string;
    avatarTitle: string;
    avatarSubtitle: string;
    avatarUseButton: string;
    avatarSelected: string;
    avatarUpdated: string;
    avatarUpdateFailed: string;
    avatarUnavailable: string;
    countryUpdated: string;
    countryCooldownPrefix: string;
    countryCooldownSuffix: string;
    countryUpdateFailed: string;
    loginRequiredTitle: string;
    loginRequiredBody: string;
    loginRequiredCta: string;
    backButton: string;
    levelLabel: string;
    globalXpRankPrefix: string;
    totalXpPrefix: string;
    settingsTitle: string;
    nicknameLabel: string;
    nicknamePlaceholder: string;
    changeButton: string;
    countryLabel: string;
    countryHint: string;
    countryNotSet: string;
    itemsCountSuffix: string;
    emptyRecentPlays: string;
    connectedAccountsTitle: string;
    linkedStatus: string;
    notLinkedStatus: string;
    unlinkButton: string;
    linkButton: string;
    streamerVerificationTitle: string;
    streamerVerificationSubtitle: string;
    ownershipVerified: string;
    unverified: string;
    verifiedConfirmedText: string;
    audienceCountLabel: string;
    audienceUnit: string;
    metricsSyncedPrefix: string;
    verifyChannelCta: string;
    verifyUnavailable: string;
    featuredReviewStatusTitle: string;
    featuredStreamerLabel: string;
    featuredSelectedSuffix: string;
    featuredHint: string;
    achievedSuffix: string;
    myGameRecordsTitle: string;
    challengeSuffix: string;
    viewFullRankingArrow: string;
    reviewNotStarted: string;
    autoReviewPending: string;
    nextReviewPrefix: string;
    notEligible: string;
    manualReviewNeeded: string;
    autoReviewFailed: string;
    nextRetryPrefix: string;
  };
  discord: {
    heroTitle1: string;
    heroTitle2: string;
    heroSubtitle: string;
    installCta: string;
    setupCta: string;
    searchCta: string;
    registerCta: string;
    guideCta: string;
    managedServersTitle: string;
    exploreAll: string;
    loadingServers: string;
    noManagedServers: string;
    loginRequired: string;
    registerPrompt: string;
    registerStart: string;
    publicPage: string;
    manageServer: string;
    registeredLabel: string;
    weeklyRankingTitle: string;
    loadingRanking: string;
    emptyWeeklyRanking: string;
    guideTitle: string;
    guideStep1: string;
    guideStep2: string;
    guideStep3: string;
    accountLinkTitle: string;
    accountLinkBody: string;
    accountLinkCta: string;
    usageGuideCta: string;
  };
  discordSetup: {
    eyebrow: string;
    title: string;
    subtitle: string;
    step1Title: string;
    step1Description: string;
    checkingInstallLink: string;
    installLinkUnavailable: string;
    installNote: string;
    installStatusHint: string;
    step2Title: string;
    step2Description: string;
    checking: string;
    owoggLoginCta: string;
    linkedNote1: string;
    linkedNote2: string;
    linkAccountCta: string;
    step3Title: string;
    step3Description: string;
    loginFirst: string;
    alreadyRegisteredPrefix: string;
    alreadyRegisteredSuffix: string;
    registerStartCta: string;
    viewServerDirectory: string;
    step4Title: string;
    step4Description: string;
    notShowingUp: string;
    troubleshootingGuide: string;
    checkSuffix: string;
    step5Title: string;
    step5Description: string;
    viewFullGuide: string;
    footerNote1: string;
    discordWikiLink: string;
    footerNote2: string;
    badgeDone: string;
    badgeTodo: string;
    badgeUnknown: string;
  };
  discordGuide: {
    eyebrow: string;
    heroTitle: string;
    heroSubtitle: string;
    installCta: string;
    installLinkHint: string;
    serverDirectoryCta: string;
    heroSetupCta: string;
    onboardingEyebrow: string;
    onboardingTitle: string;
    onboardingBody: string;
    onboardingCta: string;
    xpTitle: string;
    xpSubtitle: string;
    xpGlobalTitle: string;
    xpGlobalText: string;
    xpGuildATitle: string;
    xpGuildAText: string;
    xpGuildBTitle: string;
    xpGuildBText: string;
    antiAbuseLabel: string;
    antiAbuseText: string;
    commandsTitle: string;
    commandGamesDesc: string;
    commandLinkDesc: string;
    commandProfileDesc: string;
    commandPlayDesc: string;
    commandRankDesc: string;
    commandLeaderboardDesc: string;
    commandServerDesc: string;
    rankingGuideTitle: string;
    rankingGuideP1: string;
    rankingGuideP2: string;
    viewFullRankingCta: string;
    helpGuideTitle: string;
    helpP1: string;
    helpP2: string;
    helpP3: string;
    faqTitle: string;
    faq1Q: string;
    faq1A: string;
    faq2Q: string;
    faq2A: string;
    faq3Q: string;
    faq3A: string;
    faq4Q: string;
    faq4A: string;
    footerNote: string;
    footerHubCta: string;
  };
  discordServers: {
    pageTitle: string;
    pageSubtitle: string;
    registerCta: string;
    searchPlaceholder: string;
    searchButton: string;
    statusNoGuilds: string;
    statusUnauthorized: string;
    statusError: string;
    candidateLoadError: string;
    guildListFetchError: string;
    registerFailError: string;
    modalTitle: string;
    successTitle: string;
    viewPublicPage: string;
    manageServer: string;
    step1Label: string;
    step2Label: string;
    slugPlaceholder: string;
    step3Label: string;
    cancelButton: string;
    submittingButton: string;
    submitButton: string;
    totalCountPrefix: string;
    totalCountSuffix: string;
    searchTermLabel: string;
    loadingList: string;
    emptyResultsTitle: string;
    emptyResultsHint: string;
    owoggServerLabel: string;
    viewPageArrow: string;
  };
  discordServerSlug: {
    loadFailedGeneric: string;
    loadingServer: string;
    privateServerTitle: string;
    notFoundTitle: string;
    privateServerMessage: string;
    backToDirectory: string;
    manageServerCta: string;
    participantsLabel: string;
    participantsUnit: string;
    participantsHint: string;
    totalXpLabel: string;
    totalXpHint: string;
    weeklyXpLabel: string;
    weeklyXpHint: string;
    leaderboardTitle: string;
    tabAlltime: string;
    tabWeekly: string;
    tabGames: string;
    emptyAlltimeTitle: string;
    emptyAlltimeHintPrefix: string;
    emptyAlltimeHintSuffix: string;
    emptyWeeklyTitle: string;
    emptyWeeklyHint: string;
    loadingGame: string;
    emptyGameScoreSuffix: string;
    emptyGameHintPrefix: string;
    emptyGameHintSuffix: string;
    infoCardTitle: string;
    statusLabel: string;
    visibilityLabel: string;
  };
  discordServerManage: {
    noPermissionError: string;
    saveFailedError: string;
    unregisterFailedError: string;
    loadingManageInfo: string;
    accessDeniedTitle: string;
    backToDirectory: string;
    manageTitleSuffix: string;
    manageSubtitle: string;
    publicPageArrow: string;
    saveSuccessMessage: string;
    slugLabel: string;
    slugHintPrefix: string;
    slugHintSuffix: string;
    visibilityLabel: string;
    visibilityPublicDesc: string;
    visibilityUnlistedDesc: string;
    visibilityPrivateDesc: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    savingButton: string;
    saveButton: string;
    dangerZoneTitle: string;
    dangerZoneText: string;
    unregisterButton: string;
    unregisterConfirmTitle: string;
    unregisterConfirmBodySuffix: string;
    cancelButton: string;
    unregisteringButton: string;
    confirmUnregisterButton: string;
  };
  discordLink: {
    checkingLinkInfo: string;
    invalidTitle: string;
    invalidBodyPrefix: string;
    invalidBodySuffix: string;
    linkingInProgress: string;
    errorTitle: string;
    genericErrorMessage: string;
    alreadyLinkedTitle: string;
    linkedTitle: string;
    successBodyPrefix: string;
    successBodySuffix: string;
    goToProfileCta: string;
    linkAccountTitle: string;
    confirmPromptPrefix: string;
    confirmPromptSuffix: string;
    loginRequiredHint: string;
    loginCta: string;
    linkCta: string;
  };
  wiki: {
    navGettingStarted: string;
    navDiscordOverview: string;
    navDiscordInstall: string;
    navDiscordAccountLink: string;
    navDiscordServerRegistration: string;
    navDiscordCommands: string;
    navDiscordXp: string;
    navDiscordTroubleshooting: string;
    navAccount: string;
    navAccountOverview: string;
    navAccountMerge: string;
    navGamesRanking: string;
    navGamesOverview: string;
    navRanking: string;
    navGamesXp: string;
    navGamesDevelopment: string;
    navStreamerOverview: string;
    navStreamerVerification: string;
    navStreamerFeatured: string;
    navSupport: string;
    catSupportDesc: string;
    tocAriaLabel: string;
    homeTitle: string;
    homeSubtitle: string;
    homeInstallPrompt: string;
    homeInstallGuideLink: string;
    homeInstallGuideSuffix: string;
    catDiscordDesc: string;
    catGettingStartedDesc: string;
    catAccountDesc: string;
    catGamesDesc: string;
    catStreamerDesc: string;
    catPolicyTitle: string;
    catPolicyDesc: string;
  };
  /** Wiki article bodies. Split from `wiki` (which holds the shell: nav, home, category cards)
   * so each article's prose stays grouped by page. Sentences that wrap an inline <b>/<Link>
   * are split into ...Prefix/...Strong/...Suffix parts rather than embedding markup in the
   * string — same approach `wiki.homeInstallPrompt`/`homeInstallGuideLink` already uses. */
  wikiBody: {
    streamer: {
      title: string;
      description: string;
      intro: string;
      cardVerification: string;
      cardVerificationDesc: string;
      cardFeatured: string;
      cardFeaturedDesc: string;
      profileHint: string;
      profileLink: string;
    };
    streamerVerification: {
      title: string;
      description: string;
      platformsHeading: string;
      conditionsHeading: string;
      condOnePrefix: string;
      condOneStrong: string;
      condOneSuffix: string;
      condNoMinimum: string;
      condOauthOnly: string;
      condOneChannelOneAccount: string;
      methodHeading: string;
      step1: string;
      step2: string;
      step3: string;
      step4: string;
      calloutLoginStrong: string;
      calloutLoginBody: string;
      calloutDuplicate: string;
      footerPrefix: string;
      footerStrong: string;
      footerMid: string;
      footerLink: string;
      footerSuffix: string;
    };
    streamerFeatured: {
      title: string;
      description: string;
      conceptHeading: string;
      conceptStreamerTerm: string;
      conceptStreamerDesc: string;
      conceptFeaturedTerm: string;
      conceptFeaturedDesc: string;
      reviewHeading: string;
      reviewBody: string;
      calloutNoRankImpactStrong: string;
      calloutNoRankImpactBody: string;
      calloutTestingPhase: string;
      footerNote: string;
    };
    account: {
      title: string;
      description: string;
      loginHeading: string;
      loginBody: string;
      profileHeading: string;
      profileBody: string;
      profileLink: string;
      calloutPrefix: string;
      calloutLink: string;
      calloutSuffix: string;
    };
    accountMerge: {
      title: string;
      description: string;
      howHeading: string;
      howBodyPrefix: string;
      howBodyPrimary: string;
      howBodySuffix: string;
      stepsHeading: string;
      step1: string;
      step2: string;
      step3: string;
      step4: string;
      step5: string;
      calloutNoMergeStrong: string;
      calloutNoMergeBody: string;
      calloutAdminStrong: string;
      calloutAdminBody: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    games: {
      title: string;
      description: string;
      intro: string;
      cardRanking: string;
      cardRankingDesc: string;
      cardXp: string;
      cardXpDesc: string;
      cardDevelopment: string;
      cardDevelopmentDesc: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    gamesDevelopment: {
      title: string;
      description: string;
      intro: string;
      eligibilityHeading: string;
      eligibilityBody: string;
      eligibilityLink: string;
      sdkHeading: string;
      sdkBody: string;
      limitsHeading: string;
      limitBundle: string;
      limitExtracted: string;
      limitFiles: string;
      flowHeading: string;
      flowStep1: string;
      flowStep2: string;
      flowStep3: string;
      policyHeading: string;
      policyBody: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    gamesRanking: {
      title: string;
      description: string;
      gameHeading: string;
      gameBody: string;
      xpHeading: string;
      xpBodyPrefix: string;
      xpBodyLink: string;
      xpBodySuffix: string;
      streamerHeading: string;
      streamerBodyPrefix: string;
      streamerBodyStrong: string;
      streamerBodySuffix: string;
      streamerLinkPrefix: string;
      streamerLink: string;
      streamerLinkSuffix: string;
      calloutFeatured: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    gamesXp: {
      title: string;
      description: string;
      grantHeading: string;
      grantPerPlay: string;
      grantDailyCap: string;
      grantAfterCap: string;
      formulaHeading: string;
      formulaPrefix: string;
      formulaSuffix: string;
      calloutPrefix: string;
      calloutLink: string;
      calloutSuffix: string;
      footerPrefix: string;
      footerProfileLink: string;
      footerMid: string;
      footerRankingLink: string;
      footerSuffix: string;
    };
    gettingStarted: {
      title: string;
      description: string;
      flowHeading: string;
      step1: string;
      step2: string;
      step3: string;
      step4: string;
      step5: string;
      calloutGuest: string;
      cardCatalog: string;
      cardCatalogDesc: string;
      cardRanking: string;
      cardRankingDesc: string;
      footerPrefix: string;
      footerDiscordLink: string;
      footerMid: string;
      footerAccountLink: string;
      footerSuffix: string;
    };
    discordOverview: {
      title: string;
      description: string;
      calloutStrong: string;
      calloutBody: string;
      flowHeading: string;
      step1: string;
      step2: string;
      step3: string;
      step4: string;
      step5: string;
      cardInstall: string;
      cardInstallDesc: string;
      cardServerReg: string;
      cardServerRegDesc: string;
      cardCommands: string;
      cardCommandsDesc: string;
      cardTroubleshooting: string;
      cardTroubleshootingDesc: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    discordInstall: {
      title: string;
      description: string;
      calloutStrong: string;
      calloutBody: string;
      checklistPrefix: string;
      checklistLink: string;
      checklistSuffix: string;
      buttonLabel: string;
      loadingPrefix: string;
      loadingLink: string;
      loadingSuffix: string;
      calloutWarningStrong: string;
      calloutWarningBodyPrefix: string;
      calloutWarningLink: string;
      calloutWarningSuffix: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    discordAccountLink: {
      title: string;
      description: string;
      methodHeading: string;
      step1: string;
      step2: string;
      step3: string;
      step4: string;
      step5: string;
      calloutPrefix: string;
      calloutCode: string;
      calloutSuffix: string;
      calloutWarning: string;
      footerPrefix: string;
      footerLink1: string;
      footerMid: string;
      footerLink2: string;
      footerSuffix: string;
    };
    discordServerRegistration: {
      title: string;
      description: string;
      requirementsHeading: string;
      req1: string;
      req2: string;
      req3: string;
      stepsHeading: string;
      step1: string;
      step2: string;
      step3: string;
      step4: string;
      step5: string;
      buttonLabel: string;
      visibilityHeading: string;
      visibilityPublicDesc: string;
      visibilityUnlistedDesc: string;
      visibilityPrivateDesc: string;
      calloutStrong: string;
      calloutBody: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    discordCommands: {
      title: string;
      description: string;
      calloutEphemeral: string;
      labelWhere: string;
      labelAccountLink: string;
      labelGuildRequired: string;
      labelArgs: string;
      labelExample: string;
      labelCommonError: string;
      yes: string;
      no: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
      commands: {
        purpose: string;
        where: string;
        args: string;
        commonError: string;
      }[];
    };
    discordXp: {
      title: string;
      description: string;
      differHeading: string;
      globalTerm: string;
      globalDesc: string;
      perGuildTerm: string;
      perGuildDescPrefix: string;
      perGuildDescCode: string;
      perGuildDescSuffix: string;
      guildActivityTerm: string;
      guildActivityDesc: string;
      exampleHeading: string;
      exampleBodyPrefix: string;
      exampleBodyCode: string;
      exampleBodySuffix: string;
      cardGlobalTitle: string;
      cardGlobalText: string;
      cardGuildATitle: string;
      cardGuildAText: string;
      cardGuildBTitle: string;
      cardGuildBText: string;
      calloutNoCopyStrong: string;
      calloutNoCopyBody: string;
      calloutAbuseStrong: string;
      calloutAbuseBody: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    discordTroubleshooting: {
      title: string;
      description: string;
      calloutWarning: string;
      faqAutocomplete: {
        question: string;
        answerPrefix: string;
        answerCode: string;
        answerSuffix: string;
      };
      faqPlainMessage: { question: string; answer: string };
      faqNoResponse: { question: string; answer: string };
      faqAlreadyLinked: { question: string; answer: string };
      faqServerNotRegistered: {
        question: string;
        answerPrefix: string;
        answerLink: string;
        answerSuffix: string;
      };
      faqNotInCandidateList: { question: string; answer: string };
      faqBotNotVisible: { question: string; answer: string };
      faqBotOffline: { question: string; answer: string };
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
    /** Documentation only — the actual actionable page (mailto buttons) is /contact
     * (dict.contact). This page explains which of the three channels a given message belongs
     * on before the reader ever gets to the buttons. */
    support: {
      title: string;
      description: string;
      generalHeading: string;
      generalBody: string;
      reportHeading: string;
      reportBody: string;
      bugHeading: string;
      bugBody: string;
      tipsHeading: string;
      tip1: string;
      tip2: string;
      tip3: string;
      footerPrefix: string;
      footerLink: string;
      footerSuffix: string;
    };
  };
  /** /terms and /privacy. Section numbering matches the numbered headings shown on the page
   * (sectionNHeading etc.) so it's easy to cross-check against docs/i18n-content/03-terms-privacy.json,
   * which uses the same section order. */
  legal: {
    terms: {
      metaTitle: string;
      metaDescription: string;
      pageTitle: string;
      effectiveDate: string;
      section1Heading: string;
      section1Body: string;
      section2Heading: string;
      section2Body: string;
      section3Heading: string;
      section3Intro: string;
      section3List: string[];
      section4Heading: string;
      section4Body: string;
      section5Heading: string;
      section5Body: string;
      section6Heading: string;
      section6Body: string;
      section7Heading: string;
      section7Body: string;
      section8Heading: string;
      section8BodyPrefix: string;
      section8BodyEmail: string;
      section8BodySuffix: string;
    };
    privacy: {
      metaTitle: string;
      metaDescription: string;
      pageTitle: string;
      effectiveDate: string;
      section1Heading: string;
      section1Intro: string;
      section1List: { term: string; desc: string }[];
      section1Outro: string;
      section2Heading: string;
      section2List: string[];
      section3Heading: string;
      section3Body: string;
      section4Heading: string;
      section4Body: string;
      section5Heading: string;
      section5Body: string;
      section6Heading: string;
      section6Body: string;
      section7Heading: string;
      section7BodyPrefix: string;
      section7BodyEmail: string;
      section7BodySuffix: string;
    };
  };
  /** /games/:slug — the actual gameplay screen (header chrome, loading/error states, auth gate,
   * result overlay, and the result-metadata key labels like WPM/CPM shown per game). */
  gamePlay: {
    errorGameNotFound: string;
    gameDisabledTitle: string;
    gameDisabledBody: string;
    errorLoadFailed: string;
    errorSubmitFailed: string;
    errorNetworkSubmitFailed: string;
    errorSubmitFallback: string;
    backToList: string;
    back: string;
    loadingTitle: string;
    loadingBody: string;
    authRequiredTitle: string;
    authRequiredBody: string;
    authRequiredCta: string;
    resultTitle: string;
    finalScoreLabel: string;
    deviceBestLabel: string;
    metadataWpm: string;
    metadataCpm: string;
    metadataAccuracy: string;
    metadataCorrectChars: string;
    metadataIncorrectChars: string;
    metadataTotalTypedChars: string;
    metadataDurationMs: string;
    metadataTargetsHit: string;
    metadataMisses: string;
    metadataLevel: string;
    metadataTargets: string;
    metadataAvgPerTargetMs: string;
    metadataSequenceLength: string;
    metadataGrade: string;
    metadataAuthoritativeRawScore: string;
    guestNoticeTitle: string;
    guestNoticeBody: string;
    guestLoginCta: string;
    submittingLabel: string;
    successLabel: string;
    retrySubmitCta: string;
    /** Marks the current player's own row in GameHost's leaderboard preview. */
    leaderboardYou: string;
    retryGameCta: string;
    returnToGameCta: string;
    backToListResult: string;
    /** Generic difficulty tier labels, reused across every difficulty-supporting game (rather
     * than per-game localized content) since "normal"/"hard" are the same concept everywhere. */
    difficultyNormal: string;
    difficultyHard: string;
    /** Contains literal "{title}" and "{score}" placeholders, filled in with plain .replace()
     * calls (see game-slug.tsx) rather than a Prefix/Mid/Suffix split — English wants
     * score-before-title ("I scored X in Game") while Korean wants title-before-score
     * ("Game에서 X 기록"), so each locale needs to control the full word order itself. */
    shareText: string;
    /** X has an official web share intent (twitter.com/intent/tweet) — opens directly, no
     * clipboard step needed. */
    shareXCta: string;
    /** Discord has no equivalent web intent — this copies shareText+url to the clipboard so the
     * user can paste it into a Discord channel/DM themselves. */
    shareDiscordCta: string;
    shareDiscordCopiedFeedback: string;
    /** Captures the result card (see game-slug.tsx's shareCardRef) as a PNG and copies it to the
     * clipboard via the Clipboard API, so it can be pasted directly into Discord/X/anywhere that
     * accepts pasted images — falls back to a file download when Clipboard image writes aren't
     * supported. */
    screenshotCopyCta: string;
    screenshotCopiedFeedback: string;
    screenshotDownloadedFeedback: string;
    screenshotErrorFeedback: string;
    /** Shown briefly after clicking the X share button — X's web intent has no parameter for
     * attaching an arbitrary image, so the best available UX is: copy the result screenshot to
     * the clipboard as a courtesy, open the compose window with the text prefilled, and tell the
     * user to paste (Ctrl+V) the image in themselves. */
    shareXScreenshotHint: string;
    /** Shown on the result overlay only when the game's manifest has supportsLeaderboard: true —
     * casual games where rank doesn't mean much can opt out by setting that flag false. */
    leaderboardTitle: string;
    leaderboardEmpty: string;
    viewFullRanking: string;
    /** Shown only when manifest.presentation?.fullscreen.supported is true — see GameHost.tsx's
     * useFullscreen. Toggles based on the live document.fullscreenElement state, not assumed
     * React state, so it stays correct even after an ESC-triggered exit. */
    fullscreenEnterCta: string;
    fullscreenExitCta: string;
    /** A small badge/hint next to the button when fullscreen.recommended is true — never implies
     * automatic fullscreen, which this PR explicitly never does. */
    fullscreenRecommendedHint: string;
    /** Non-blocking advisories shown only in a mobile-like (coarse-pointer) environment — see
     * presentationAdvisory.ts. Never shown on desktop regardless of the game's own
     * presentation.mobile value, and never block PLAY. */
    mobileExperimentalNotice: string;
    mobileUnsupportedNotice: string;
    /** Shown only when the game's presentation.mobile.orientation preference doesn't match the
     * device's actual current orientation — a hint, never a lock/forced rotation. */
    orientationPortraitHint: string;
    orientationLandscapeHint: string;
    bookmarkCta: string;
    bookmarkedCta: string;
    shareGameCta: string;
    shareGameCopied: string;
    feedbackCta: string;
    mobilePlayCta: string;
    theaterModeEnterCta: string;
    theaterModeExitCta: string;
    adLabel: string;
    adPlaceholder: string;
    recommendedGamesTitle: string;
    recommendedGamesEmpty: string;
    gameInfoTitle: string;
    publisherLabel: string;
    publishedLabel: string;
    playerStatsLabel: string;
    bookmarkStatsLabel: string;
    officialGameBadge: string;
    userGameBadge: string;
    mobilePlayTitle: string;
    mobilePlayBody: string;
    copyGameLinkCta: string;
    closeDialogCta: string;
    gameLinkCopied: string;
  };
  /** /games/:slug/ranking — a dedicated per-game daily/weekly/monthly leaderboard page. Table
   * column headers are shared with dict.ranking (rankHeader/playerHeader/recordHeader/dateHeader
   * etc.) rather than duplicated here. */
  gameRanking: {
    eyebrow: string;
    backToGame: string;
    notSupported: string;
    notSupportedBody: string;
  };
  /** /users/:id — the public profile page (distinct from the private /profile "My Page").
   * Uses the account's stable internal id as the URL identifier (survives nickname changes
   * and stays valid across future Google/Discord account linking/merging). */
  userProfile: {
    eyebrow: string;
    backToHome: string;
    notFoundTitle: string;
    notFoundBody: string;
    loadErrorBody: string;
    retryButton: string;
    joinedPrefix: string;
    levelLabel: string;
    globalRankPrefix: string;
    streakLabel: string;
    streakDaysSuffix: string;
    longestStreakPrefix: string;
    achievementsTitle: string;
    achievementsEmpty: string;
    achievedSuffix: string;
    gameRecordsTitle: string;
    gameRecordsEmpty: string;
    streamerBadgesTitle: string;
    manageProfileCta: string;
    favoritesTitle: string;
    favoritesEmpty: string;
    recentPlaysTitle: string;
    recentPlaysEmpty: string;
    itemsCountSuffix: string;
    /** Badge shown to the OWNER next to a section only they can see, so it's obvious the
     * section isn't part of what visitors get. */
    onlyVisibleToYou: string;
    settingsCta: string;
  };
  /** Header icon that lists PUBLIC-visibility registered Discord servers (lives next to
   * favorites/language selector) — fetched lazily on first open, not on every page load. */
  registeredServers: {
    ariaLabel: string;
    title: string;
    empty: string;
    viewAll: string;
  };
  /** /changelog — page chrome only. Individual entries (apps/web/app/features/changelog/entries.ts)
   * stay Korean-only for now per the "translation doesn't have to happen inline" policy
   * (docs/i18n-content/GUIDE.md) — this is fast-growing content, not a fixed page. */
  changelog: {
    eyebrow: string;
    title: string;
    subtitle: string;
    emptyState: string;
    tagFeature: string;
    tagImprovement: string;
    tagFix: string;
  };
  platformIcon: {
    chzzkLabel: string;
    soopLabel: string;
    channelSuffix: string;
    verifiedPlatforms: string;
  };
  contact: {
    eyebrow: string;
    title: string;
    subtitle: string;
    emailCta: string;
    emailCopiedFeedback: string;
    generalLabel: string;
    generalDesc: string;
    reportLabel: string;
    reportDesc: string;
    bugLabel: string;
    bugDesc: string;
    guidanceTitle: string;
    guidanceItems: string[];
    discordAltTitle: string;
    discordAltBody: string;
    discordAltCta: string;
  };
}

export const DICTIONARIES: Record<SupportedLocale, Dictionary> = {
  "ko-KR": {
    common: {
      loading: "불러오는 중...",
      error: "문제가 발생했습니다.",
      retry: "다시 시도",
      empty: "표시할 항목이 없습니다.",
      save: "저장",
      cancel: "취소",
    },
    nav: {
      searchPlaceholder: "게임명, 태그 또는 카테고리 검색...",
      favorites: "즐겨찾기",
      login: "로그인",
      logout: "로그아웃",
      myProfile: "프로필",
      settings: "설정",
      ranking: "명예의 전당",
      wiki: "Wiki",
      accountSuffix: " 계정",
    },
    sidebar: {
      openMenuAria: "메뉴 열기",
      expandMenuAria: "사이드바 펼치기",
      collapseMenuAria: "사이드바 접기",
      mobileMenuTitle: "메뉴",
      home: "홈",
      allGames: "전체 게임",
      popularGames: "인기 게임",
      rankingRecords: "랭킹 & 기록",
      otherHeading: "기타",
      discordHub: "Discord",
      moreHeading: "더보기",
      favorites: "즐겨찾기",
      discordServers: "등록된 디스코드 서버",
    },
    footer: {
      tagline: "설치 없이, 1초 만에 즐기는 미니게임",
      allGames: "전체 게임 목록",
      ranking: "명예의 전당",
      wiki: "Wiki",
      changelog: "업데이트 로그",
      contactUs: "문의하기",
      rightsReserved: "All rights reserved.",
    },
    home: {
      heroEyebrow: "설치 없이 바로 플레이",
      heroTitle: "심심할 틈 없이, 게임을 한곳에",
      heroSubtitle: "가벼운 웹 미니게임을 모아 즐기고, 친구들과 기록을 겨뤄보세요.",
      browseGames: "게임 둘러보기",
      lineupTitle: "미니게임 라인업",
      itemsCountSuffix: "개",
      popularTitle: "인기 게임",
      recentPlaysTitle: "최근 플레이",
      favoritesTitle: "내 즐겨찾기",
      emptyCategory: "해당 카테고리에 준비된 게임이 없습니다.",
      gridColumnsAriaPrefix: "",
      gridColumnsAriaSuffix: "열로 보기",
      teaserTitle: "실시간 랭킹 & 멀티플레이어 업데이트 예정",
      teaserBody:
        "친구와 링크 하나로 접속해 함께 실시간 대결을 펼칠 수 있는 멀티 모드가 곧 출시됩니다.",
      teaserCta: "게임 미리보기",
    },
    language: { label: "언어", ko: "한국어", en: "English", ja: "日本語", zh: "简体中文" },
    loginModal: {
      title: "OwOGG 소셜 로그인",
      subtitle: "원하는 소셜 계정을 클릭하면 안전하게 로그인됩니다.",
      close: "닫기",
      googleButton: "Google 계정으로 로그인",
      googleLoading: "Google 로그인 중...",
      googleUnconfigured: "Google 로그인이 아직 설정되지 않았습니다.",
      discordButton: "Discord 계정으로 로그인",
      discordLoading: "Discord 로그인 중...",
      discordUnconfigured: "Discord 로그인이 아직 설정되지 않았습니다.",
      providerChecking: "로그인 서버 설정을 확인하고 있습니다.",
      providerUnavailable: "로그인 서버에 연결할 수 없습니다.",
      retry: "다시 확인",
    },
    games: {
      eyebrow: "Game Collection",
      title: "전체 미니게임",
      countSuffix: "개의 가벼운 미니게임이 준비되어 있습니다.",
      searchPlaceholder: "게임 검색...",
      emptyFavorites: "아직 즐겨찾기한 게임이 없습니다.",
      emptySearch: "검색 결과와 일치하는 게임이 없습니다.",
      sortLabel: "게임 정렬",
      sortOptions: {
        popular: "인기 순",
        newest: "출시 순",
        players: "조회수 순",
        bookmarks: "북마크 순",
      },
      playerCountLabel: "플레이한 유저",
      bookmarkCountLabel: "북마크한 유저",
      categories: {
        all: "전체",
        popular: "인기",
        reaction: "순발력",
        brain: "두뇌",
        aim: "에임",
        typing: "타자",
        favorites: "즐겨찾기",
      },
      addFavoriteAriaPrefix: "",
      addFavoriteAriaSuffix: " 즐겨찾기 추가",
      removeFavoriteAriaPrefix: "",
      removeFavoriteAriaSuffix: " 즐겨찾기 해제",
    },
    ranking: {
      eyebrow: "Leaderboard & Community Hall of Fame",
      title: "명예의 전당",
      subtitle: "최고 기록, 유저 활동 레벨, 그리고 검증된 스트리머 랭킹입니다.",
      gameTab: "일반 랭킹",
      xpTab: "경험치 랭킹",
      streamerTab: "스트리머 랭킹",
      allCategories: "전체 종목",
      allPlatforms: "전체 플랫폼",
      platformChzzk: "치지직 (CHZZK)",
      platformSoop: "SOOP (아프리카)",
      scoreMode: "게임 점수",
      xpMode: "경험치 (XP)",
      streakMode: "연속 출석",
      dailyPeriod: "일간",
      weeklyPeriod: "주간",
      monthlyPeriod: "월간",
      rankHeader: "순위",
      playerHeader: "플레이어",
      streamerHeader: "스트리머",
      countryHeader: "국가/지역",
      categoryHeader: "종목",
      recordHeader: "기록",
      dateHeader: "달성일",
      modeHeader: "모드",
      levelHeader: "레벨",
      totalXpHeader: "총 경험치",
      recordOrCategory: "기록 / 종목",
      activityLevel: "활동 레벨 (XP)",
      badgeHeader: "뱃지",
      platformHeader: "플랫폼",
      emptyGames: "아직 등록된 기록이 없습니다. 첫 기록의 주인공이 되어보세요.",
      emptyXp: "아직 활동 내역이 있는 유저가 없습니다.",
      emptyStreak: "현재 이어지고 있는 연속 출석 기록이 없습니다.",
      unknownCountry: "국가/지역 미지정 또는 비공개",
      emptyStreamerTitle: "아직 검증된 스트리머 기록이 없습니다",
      emptyStreamerBody:
        "해당 기간과 필터에 맞는 인증 스트리머의 게임 기록·XP·연속 출석이 아직 없습니다.",
      retryButton: "다시 시도",
      rank1: "1위",
      rank2: "2위",
      rank3: "3위",
    },
    profile: {
      pageTitle: "설정",
      pageSubtitle: "계정 정보와 공개 범위를 관리합니다.",
      visibilityTitle: "공개 범위",
      visibilitySubtitle: "각 항목을 다른 사람의 프로필 방문 시 보여줄지 선택합니다.",
      visibilityFavoritesLabel: "즐겨찾기",
      visibilityRecentPlaysLabel: "최근 플레이",
      visibilityPublicOption: "공개",
      visibilityPrivateOption: "비공개",
      visibilityUpdated: "공개 범위를 저장했습니다.",
      visibilityUpdateFailed: "공개 범위를 저장하지 못했습니다.",
      joinedLabel: "가입일",
      viewProfileCta: "프로필 보기",
      logout: "로그아웃",
      favoritesTitle: "즐겨찾기",
      emptyFavorites:
        "아직 즐겨찾기한 게임이 없습니다. 게임 카드의 북마크 아이콘을 눌러 추가해보세요.",
      recentPlaysTitle: "최근 플레이",
      achievementsTitle: "도전과제",
      emptyAchievements:
        "아직 달성한 도전과제가 없습니다. 게임을 플레이하고 즐겨찾기를 추가해보세요!",
      noRecordLabel: "계정 기록 없음",
      deviceRecordLabel: "기기 기록",
      noRecordYetHint: "아직 기록이 없어요 — 지금 도전해보세요!",
      justNow: "방금 전",
      minutesAgoSuffix: "분 전",
      hoursAgoSuffix: "시간 전",
      daysAgoSuffix: "일 전",
      linkSuccess: "로그인 수단이 연결되었습니다.",
      alreadyLinkedAccount: "이미 연결된 계정입니다.",
      linkError: "로그인 수단 연결 중 오류가 발생했습니다.",
      streamerVerifySuccess: "스트리머 채널 소유권 인증이 완료되었습니다.",
      streamerVerifyConflict: "이 채널은 이미 다른 OwOGG 스트리머 계정에 연동되어 있습니다.",
      streamerVerifyUnconfigured: "현재 해당 플랫폼 인증을 사용할 수 없습니다.",
      streamerVerifyUnauthorized: "로그인이 만료되었습니다. 다시 로그인 해주세요.",
      streamerVerifyError: "스트리머 채널 인증 중 오류가 발생했습니다.",
      googleScriptNotReady: "Google 로그인 스크립트가 준비되지 않았습니다.",
      googleLinkSuccess: "Google 로그인이 연결되었습니다.",
      googleAccountInUse: "이 Google 계정은 이미 다른 OwOGG 계정으로 사용 중입니다.",
      googleAlreadyLinked: "이 계정에는 이미 Google 로그인이 연결되어 있습니다.",
      googleLinkFailed: "Google 연결에 실패했습니다.",
      unlinkSuccessSuffix: "연결이 해제되었습니다.",
      lastAuthProviderError: "마지막 로그인 수단은 해제할 수 없습니다.",
      unlinkFailed: "연결 해제에 실패했습니다.",
      mergeCompleted: "계정 통합이 완료되었습니다.",
      nicknameUpdated: "닉네임이 변경되었습니다.",
      nicknameCooldownPrefix: "닉네임은",
      nicknameCooldownSuffix: "이후 다시 변경할 수 있습니다.",
      nicknameUpdateFailed: "닉네임 변경에 실패했습니다.",
      nicknamePolicyHint:
        "닉네임은 중복될 수 있으며 공개 화면에는 ‘닉네임 #사용자번호’로 표시됩니다. 변경 후 30일 동안 다시 바꿀 수 없습니다.",
      nicknamePreviewLabel: "공개 표시",
      avatarTitle: "프로필 이미지",
      avatarSubtitle: "연결된 Google 또는 Discord 계정의 이미지 중 하나를 선택합니다.",
      avatarUseButton: "이 이미지 사용",
      avatarSelected: "현재 사용 중",
      avatarUpdated: "프로필 이미지를 변경했습니다.",
      avatarUpdateFailed: "프로필 이미지를 변경하지 못했습니다.",
      avatarUnavailable: "사용 가능한 이미지가 없습니다.",
      countryUpdated: "국가/지역이 변경되었습니다.",
      countryCooldownPrefix: "국가/지역은",
      countryCooldownSuffix: "이후 다시 변경할 수 있습니다.",
      countryUpdateFailed: "국가/지역 변경에 실패했습니다.",
      loginRequiredTitle: "로그인이 필요한 페이지입니다",
      loginRequiredBody: "구글 또는 디스코드 계정으로 로그인하고 내 게임 기록을 관리하세요.",
      loginRequiredCta: "로그인하기",
      backButton: "이전으로 돌아가기",
      levelLabel: "레벨",
      globalXpRankPrefix: "전체 XP 랭킹 #",
      totalXpPrefix: "총 ",
      settingsTitle: "프로필 설정",
      nicknameLabel: "닉네임",
      nicknamePlaceholder: "닉네임을 입력하세요",
      changeButton: "변경",
      countryLabel: "국가/지역",
      countryHint: "(선택, 자기 신고 정보이며 국적 인증이 아닙니다)",
      countryNotSet: "설정 안 함",
      itemsCountSuffix: "개",
      emptyRecentPlays: "아직 플레이 기록이 없습니다. 게임을 플레이하면 여기에 표시돼요.",
      connectedAccountsTitle: "연결된 로그인 계정",
      linkedStatus: "연결됨",
      notLinkedStatus: "연결 안 됨",
      unlinkButton: "연결 해제",
      linkButton: "연결",
      streamerVerificationTitle: "스트리머 채널 소유권 인증",
      streamerVerificationSubtitle:
        "공식 OAuth / API를 통해 해당 채널을 직접 소유하고 있음을 검증합니다. (셀프 텍스트 입력 및 웹 스크래핑 금지)",
      ownershipVerified: "소유권 인증됨",
      unverified: "미인증",
      verifiedConfirmedText: "✓ OwOGG가 해당 사용자의 채널 소유권을 공식 API로 확인했습니다.",
      audienceCountLabel: "구독자/팔로워",
      audienceUnit: "명",
      metricsSyncedPrefix: "· 지표 동기화",
      verifyChannelCta: "채널 소유권 인증",
      verifyUnavailable: "현재 인증을 사용할 수 없습니다",
      featuredReviewStatusTitle: "Featured 심사 상태",
      featuredStreamerLabel: "★ Featured Streamer",
      featuredSelectedSuffix: "선정",
      featuredHint:
        "Featured는 공식 채널 지표 기반 자격(구독자/팔로워 12,000+ · 채널 120일+)이며 게임 점수·XP·랭킹 순위에는 영향을 주지 않습니다.",
      achievedSuffix: "달성",
      myGameRecordsTitle: "내 게임별 최고 기록",
      challengeSuffix: "도전",
      viewFullRankingArrow: "전체 랭킹 보기 →",
      reviewNotStarted: "채널 소유권 인증 완료 후 자동 심사가 시작됩니다. (약 6시간 후 첫 심사)",
      autoReviewPending: "자동 심사 대기 중",
      nextReviewPrefix: "(다음 심사",
      notEligible: "현재 기준 미달",
      manualReviewNeeded: "추가 확인 필요",
      autoReviewFailed: "자동 심사 일시 실패 (재시도 대기)",
      nextRetryPrefix: "— 다음 재시도",
    },
    discord: {
      heroTitle1: "친구들과 게임 기록을",
      heroTitle2: "경쟁하고 소통하세요",
      heroSubtitle:
        "OwOGG Discord Bot을 내 서버에 등록하고 커뮤니티 전용 리더보드와 서버 전용 페이지를 구축하세요.",
      installCta: "Discord에 OwOGG 추가",
      setupCta: "🧭 설치 가이드 (5단계)",
      searchCta: "🔍 서버 검색",
      registerCta: "⚡ 내 서버 등록 (관리자 권한)",
      guideCta: "📖 Discord 이용 가이드",
      managedServersTitle: "🛡️ 내가 관리하는 등록 서버",
      exploreAll: "전체 탐색 →",
      loadingServers: "서버 목록 불러오는 중...",
      noManagedServers: "관리 중인 등록 서버가 없습니다",
      loginRequired: "로그인이 필요합니다",
      registerPrompt: "Discord 관리자 권한이 있는 서버를 OwOGG에 등록하여 커뮤니티를 시작해보세요.",
      registerStart: "서버 등록 시작하기",
      publicPage: "공개 페이지",
      manageServer: "서버 관리",
      registeredLabel: "등록일",
      weeklyRankingTitle: "이번 주 서버 활동 랭킹",
      loadingRanking: "랭킹 불러오는 중...",
      emptyWeeklyRanking: "이번 주 등록된 서버 활동이 없습니다",
      guideTitle: "📌 이용 안내",
      guideStep1: "서버 등록은 Discord 관리자(MANAGE_GUILD) 권한을 가진 유저만 가능합니다.",
      guideStep2: "공개(PUBLIC) 등록 시 OwOGG 디렉토리 및 검색에 노출됩니다.",
      guideStep3: "/owogg play로 게임을 플레이하면 이 서버에 XP가 기여되며 주간 랭킹에 집계됩니다.",
      accountLinkTitle: "🔗 Discord 계정 연동",
      accountLinkBody:
        "OwOGG 계정과 Discord 계정을 연동하면 봇 커맨드(/owogg profile)에서 본인 정보를 확인할 수 있습니다.",
      accountLinkCta: "계정 연동 페이지 이동",
      usageGuideCta: "Discord 사용 방법 보기",
    },
    discordSetup: {
      eyebrow: "OwOGG × Discord",
      title: "Discord 설치 가이드",
      subtitle:
        "아래 5단계만 따라 하면 서버에서 바로 OwOGG를 사용할 수 있습니다. Bot Token, Application ID 같은 값은 필요 없습니다 — 그런 값은 OwOGG 운영진만 다룹니다.",
      step1Title: "Discord에 OwOGG 추가",
      step1Description: "서버 관리자 권한이 있는 계정으로 Discord 앱을 서버에 설치합니다.",
      checkingInstallLink: "설치 링크 확인 중...",
      installLinkUnavailable:
        "설치 링크가 아직 준비되지 않았습니다. 서버 관리자에게 공식 설치 링크를 문의하세요.",
      installNote:
        "Discord 앱 설치는 OwOGG 서버 등록(3단계)과 다릅니다 — 설치만으로 서버가 자동 등록되지 않습니다.",
      installStatusHint:
        "이 배지는 설치 여부를 자동으로 확인할 수 없어 항상 이렇게 표시됩니다 — 이미 설치했다면 정상이며, 서버 멤버 목록에 OwOGG가 보이면 설치가 완료된 것입니다.",
      step2Title: "Discord 계정 연결",
      step2Description:
        "Discord 봇 명령어에서 본인 OwOGG 정보를 사용할 수 있도록 계정을 연결합니다.",
      checking: "확인 중...",
      owoggLoginCta: "OwOGG 로그인",
      linkedNote1: "연결되었습니다. Discord에서",
      linkedNote2: "을 사용할 수 있습니다.",
      linkAccountCta: "계정 연결 페이지 이동",
      step3Title: "서버 등록",
      step3Description:
        "Discord 서버 관리(MANAGE_GUILD) 권한이 있는 서버를 OwOGG 커뮤니티로 등록합니다.",
      loginFirst: "먼저 OwOGG에 로그인해주세요.",
      alreadyRegisteredPrefix: "이미 ",
      alreadyRegisteredSuffix: "개 서버를 등록/관리하고 있습니다.",
      registerStartCta: "서버 등록 시작",
      viewServerDirectory: "서버 디렉토리 보기",
      step4Title: "/owogg games 테스트",
      step4Description: "Discord 채널에서 슬래시 명령어가 정상적으로 자동완성되는지 확인합니다.",
      notShowingUp: "자동완성에 나오지 않으면",
      troubleshootingGuide: "문제 해결 가이드",
      checkSuffix: "를 확인하세요.",
      step5Title: "/owogg play로 시작",
      step5Description: "이 서버에 귀속되는 플레이 링크를 발급받아 서버 XP를 쌓기 시작합니다.",
      viewFullGuide: "전체 이용 가이드 보기",
      footerNote1:
        "일반 사용자는 Bot Token, Application ID, Public Key를 입력할 필요가 없습니다. 더 자세한 설명은",
      discordWikiLink: "Discord Wiki",
      footerNote2: "에서 확인하세요.",
      badgeDone: "완료",
      badgeTodo: "진행 필요",
      badgeUnknown: "직접 확인",
    },
    discordGuide: {
      eyebrow: "OwOGG × Discord",
      heroTitle: "Discord에서 OwOGG 사용하기",
      heroSubtitle:
        "서버에서 게임을 시작하고, 나의 활동을 서버 XP와 리더보드로 확인하세요. OwOGG는 상시 Gateway 봇이 아니라 서명된 HTTP Interactions로 동작합니다.",
      installCta: "Discord에 추가",
      installLinkHint: "설치 링크는 서버 관리자 안내를 확인하세요",
      serverDirectoryCta: "서버 디렉토리",
      heroSetupCta: "5단계 설치 가이드",
      onboardingEyebrow: "ONBOARDING",
      onboardingTitle: "설치·계정 연결·서버 등록이 아직인가요?",
      onboardingBody:
        "설치부터 계정 연결, 서버 등록까지 5단계 진행 상태를 실시간 체크리스트에서 확인하고 바로 이어서 진행할 수 있습니다.",
      onboardingCta: "5단계 설치 가이드 열기",
      xpTitle: "서버 XP가 계산되는 방식",
      xpSubtitle: "글로벌 XP와 서버 XP는 같은 숫자를 복사하는 구조가 아닙니다.",
      xpGlobalTitle: "글로벌 XP",
      xpGlobalText: "OwOGG 전체 진행도",
      xpGuildATitle: "Guild A 사용자 XP",
      xpGuildAText: "A에서 만든 유효한 기여",
      xpGuildBTitle: "Guild B",
      xpGuildBText: "기존 XP가 자동 복사되지 않음",
      antiAbuseLabel: "어뷰징 방지:",
      antiAbuseText:
        "사용자×게임×UTC 하루 기준 글로벌 XP 지급은 최대 10회입니다. 상한에 도달하면 게임 완료는 가능하지만 추가 XP는 지급되지 않습니다.",
      commandsTitle: "명령어",
      commandGamesDesc: "플레이 가능한 게임 목록을 확인합니다.",
      commandLinkDesc: "Discord 계정과 OwOGG 계정을 연결합니다.",
      commandProfileDesc: "연결된 계정의 프로필, 레벨, 글로벌 XP를 확인합니다.",
      commandPlayDesc: "서버에 귀속되는 1회용 게임 플레이 링크를 만듭니다.",
      commandRankDesc: "현재 서버에서 나의 XP와 순위를 확인합니다.",
      commandLeaderboardDesc: "현재 서버 XP Top 10을 확인합니다.",
      commandServerDesc: "서버 전체 XP와 주간 활동을 확인합니다.",
      rankingGuideTitle: "서버 랭킹 보기",
      rankingGuideP1:
        "서버 페이지에서 서버 XP, 주간 서버 XP, 게임별 서버 참여자 기록을 확인할 수 있습니다.",
      rankingGuideP2:
        "공개 전역 서버 활동 랭킹에는 `PUBLIC` 활성 서버만 표시됩니다. 참여자 수는 OwOGG 활동을 만든 사용자 기준이며 Discord 전체 멤버 수가 아닙니다.",
      viewFullRankingCta: "OwOGG 전체 랭킹 보기",
      helpGuideTitle: "문제 해결",
      helpP1:
        "서버가 등록되지 않았다는 메시지가 나오면 관리자가 서버 등록을 완료했는지 확인하세요.",
      helpP2:
        "계정 연결 오류는 `/owogg link`를 새로 실행하고 만료되지 않은 링크로 다시 확인합니다.",
      helpP3: "Play 링크가 만료되었거나 이미 사용되었으면 새 링크를 발급해야 합니다.",
      faqTitle: "자주 묻는 질문",
      faq1Q: "앱을 설치하면 서버가 자동으로 공개되나요?",
      faq1A:
        "아니요. 앱 설치와 OwOGG 서버 등록은 별개입니다. 관리자가 웹에서 길드를 확인하고 가시성을 직접 선택해야 합니다.",
      faq2Q: "OwOGG가 Discord 서버의 모든 멤버를 가져오나요?",
      faq2A:
        "아니요. 공식 OAuth로 관리 가능한 길드를 확인하고, XP 랭킹에는 OwOGG 활동을 만든 참여자만 사용합니다.",
      faq3Q: "기존 글로벌 XP를 서버에 한 번에 가져올 수 있나요?",
      faq3A:
        "아니요. 새 Guild는 0에서 시작하며 `/owogg play`로 만든 유효한 완료만 서버에 귀속됩니다.",
      faq4Q: "상시 봇 프로세스를 실행해야 하나요?",
      faq4A:
        "v1에서는 필요하지 않습니다. Discord HTTP Interactions endpoint와 Cloudflare Worker가 요청을 처리합니다.",
      footerNote: "더 자세한 운영 절차는 Discord Bot 운영 가이드에서 확인하세요.",
      footerHubCta: "Discord Hub로 이동",
    },
    discordServers: {
      pageTitle: "🔍 Discord 서버 디렉토리",
      pageSubtitle: "OwOGG에 등록된 Discord 커뮤니티 서버를 탐색하거나 내 서버를 새로 등록하세요.",
      registerCta: "🏰 내 서버 등록하기",
      searchPlaceholder: "서버 이름 또는 vanity slug 검색...",
      searchButton: "검색",
      statusNoGuilds: "관리자(MANAGE_GUILD) 권한을 가진 Discord 서버를 찾을 수 없습니다.",
      statusUnauthorized: "서버 등록을 위해 로그인이 필요합니다.",
      statusError: "Discord 인증 중 오류가 발생했습니다. 다시 시도해 주세요.",
      candidateLoadError:
        "등록 가능한 서버 목록을 불러올 수 없습니다. 만료되었거나 이미 사용된 토큰입니다.",
      guildListFetchError: "서버 목록 조회 실패",
      registerFailError: "서버 등록 실패",
      modalTitle: "🏰 Discord 서버 등록",
      successTitle: "서버가 성공적으로 등록되었습니다!",
      viewPublicPage: "공개 페이지 보기",
      manageServer: "서버 관리하기",
      step1Label: "1. 등록할 서버 선택 (관리 중인 길드)",
      step2Label: "2. Vanity Slug 주소 설정 (옵션)",
      slugPlaceholder: "자동 생성 (영문 소문자, 숫자, -)",
      step3Label: "3. 가시성 선택",
      cancelButton: "취소",
      submittingButton: "등록 중...",
      submitButton: "서버 등록 완료",
      totalCountPrefix: "총 ",
      totalCountSuffix: "개의 공개 서버가 등록되어 있습니다.",
      searchTermLabel: "검색어:",
      loadingList: "서버 목록을 불러오는 중...",
      emptyResultsTitle: "검색 조건에 맞는 공개 서버가 없습니다.",
      emptyResultsHint: "다른 검색어로 찾아보거나 새로운 서버를 등록해보세요.",
      owoggServerLabel: "OwOGG 서버",
      viewPageArrow: "페이지 보기 →",
    },
    discordServerSlug: {
      loadFailedGeneric: "서버 정보를 불러올 수 없습니다.",
      loadingServer: "서버 정보를 불러오는 중...",
      privateServerTitle: "비공개(PRIVATE) 서버",
      notFoundTitle: "서버를 찾을 수 없습니다",
      privateServerMessage:
        "이 서버는 PRIVATE 가시성으로 설정되어 있으며, 권한을 가진 관리자만 접근할 수 있습니다.",
      backToDirectory: "← 디렉토리로 돌아가기",
      manageServerCta: "⚙️ 서버 관리",
      participantsLabel: "OwOGG 참여 멤버",
      participantsUnit: "명",
      participantsHint: "기여한 실적 유저 수",
      totalXpLabel: "서버 총 누적 XP",
      totalXpHint: "모든 게임 활동 합산",
      weeklyXpLabel: "이번 주 서버 XP",
      weeklyXpHint: "월요일 00:00 KST 기준",
      leaderboardTitle: "서버 리더보드",
      tabAlltime: "⚡ 서버 XP",
      tabWeekly: "📅 주간 XP",
      tabGames: "🎮 게임별 기록",
      emptyAlltimeTitle: "아직 이 서버에 누적된 XP가 없습니다",
      emptyAlltimeHintPrefix: "Discord 채널에서",
      emptyAlltimeHintSuffix: "명령어를 실행하여 게임에 기여해보세요!",
      emptyWeeklyTitle: "이번 주 이 서버에 누적된 XP가 없습니다",
      emptyWeeklyHint: "월요일 00:00 KST 이후 첫 플레이를 시작하여 주간 랭크를 차지해보세요!",
      loadingGame: "게임을 불러오는 중...",
      emptyGameScoreSuffix: "에 기록된 서버 멤버 스코어가 없습니다",
      emptyGameHintPrefix: "Discord 채널에서",
      emptyGameHintSuffix: "명령어로 도전해보세요!",
      infoCardTitle: "OwOGG 서버 정보",
      statusLabel: "상태",
      visibilityLabel: "가시성",
    },
    discordServerManage: {
      noPermissionError:
        "이 서버를 관리할 권한이 없습니다. Discord 관리자 계정으로 로그인되어 있는지 확인하세요.",
      saveFailedError: "설정 저장 실패",
      unregisterFailedError: "서버 해제 실패",
      loadingManageInfo: "서버 관리 정보를 불러오는 중...",
      accessDeniedTitle: "접근 권한 없음",
      backToDirectory: "← 디렉토리로 이동",
      manageTitleSuffix: "서버 관리",
      manageSubtitle:
        "공개/비공개 가시성, 커스텀 Vanity Slug 주소 및 설명 문구를 설정할 수 있습니다.",
      publicPageArrow: "공개 페이지 →",
      saveSuccessMessage: "설정이 성공적으로 저장되었습니다.",
      slugLabel: "Vanity Slug 주소 (영문 소문자, 숫자, -)",
      slugHintPrefix: "변경하더라도 Discord Guild ID(",
      slugHintSuffix: ") 자체는 변경되지 않습니다.",
      visibilityLabel: "서버 가시성 (Visibility)",
      visibilityPublicDesc: "검색 노출 및 공개 페이지 접속 가능",
      visibilityUnlistedDesc: "검색 미노출, 직링크 페이지 접속 가능",
      visibilityPrivateDesc: "검색 미노출, 관리자만 접근 가능",
      descriptionLabel: "서버 설명 문구",
      descriptionPlaceholder: "서버의 특징이나 커뮤니티 소개글을 입력하세요...",
      savingButton: "저장 중...",
      saveButton: "설정 저장",
      dangerZoneTitle: "위험 구역 (Danger Zone)",
      dangerZoneText:
        "서버 등록을 해제하면 OwOGG 디렉토리에서 제외되고 `DISABLED` 상태로 변경됩니다. (Discord 서버 자체에는 영향이 없습니다)",
      unregisterButton: "서버 등록 해제",
      unregisterConfirmTitle: "서버 등록을 해제하시겠습니까?",
      unregisterConfirmBodySuffix: "서버가 OwOGG 디렉토리 및 검색에서 제외됩니다.",
      cancelButton: "취소",
      unregisteringButton: "해제 중...",
      confirmUnregisterButton: "확인 (해제)",
    },
    discordLink: {
      checkingLinkInfo: "연동 정보를 확인하는 중...",
      invalidTitle: "유효하지 않은 연동 링크입니다",
      invalidBodyPrefix: "링크가 만료되었거나 이미 사용되었습니다. Discord 서버에서",
      invalidBodySuffix: "를 다시 실행해주세요.",
      linkingInProgress: "Discord 계정을 연동하는 중...",
      errorTitle: "연동에 실패했습니다",
      genericErrorMessage: "연동 중 오류가 발생했습니다.",
      alreadyLinkedTitle: "이미 연동되어 있습니다",
      linkedTitle: "Discord 계정이 연동되었습니다",
      successBodyPrefix: "이제 Discord에서",
      successBodySuffix: "명령어로 OwOGG 계정 정보를 확인할 수 있습니다.",
      goToProfileCta: "내 프로필로 이동",
      linkAccountTitle: "Discord 계정 연동",
      confirmPromptPrefix: "Discord 계정",
      confirmPromptSuffix: "을 현재 로그인한 OwOGG 계정과 연동하시겠습니까?",
      loginRequiredHint: "연동하려면 먼저 OwOGG에 로그인해주세요.",
      loginCta: "로그인하기",
      linkCta: "연동하기",
    },
    wiki: {
      navGettingStarted: "시작하기",
      navDiscordOverview: "Discord 개요",
      navDiscordInstall: "설치하기",
      navDiscordAccountLink: "계정 연결",
      navDiscordServerRegistration: "서버 등록",
      navDiscordCommands: "명령어",
      navDiscordXp: "서버 XP",
      navDiscordTroubleshooting: "문제 해결",
      navAccount: "계정",
      navAccountOverview: "계정 개요",
      navAccountMerge: "계정 통합",
      navGamesRanking: "게임과 랭킹",
      navGamesOverview: "게임 개요",
      navRanking: "랭킹",
      navGamesXp: "XP와 레벨",
      navGamesDevelopment: "게임 개발 및 등록",
      navStreamerOverview: "Streamer 개요",
      navStreamerVerification: "채널 소유권 인증",
      navStreamerFeatured: "Featured Streamer",
      navSupport: "지원",
      catSupportDesc: "문의, 신고, 버그 제보 채널 안내",
      tocAriaLabel: "Wiki 목차",
      homeTitle: "궁금한 걸 빠르게 찾아보세요",
      homeSubtitle:
        "Discord 설치부터 랭킹 계산 방식까지, OwOGG를 사용하는 데 필요한 모든 설명을 한곳에 모았습니다.",
      homeInstallPrompt: "더 빠른 Discord 설치가 필요하신가요?",
      homeInstallGuideLink: "5단계 설치 가이드",
      homeInstallGuideSuffix: "로 바로 이동하세요.",
      catDiscordDesc: "서버 설치, 계정 연결, 서버 등록, 명령어, 서버 XP, 문제 해결.",
      catGettingStartedDesc: "OwOGG 계정 만들기부터 첫 게임까지, 가장 빠른 시작 경로.",
      catAccountDesc: "로그인 방식, 프로필 설정, 여러 계정을 하나로 합치는 계정 통합.",
      catGamesDesc: "게임 카탈로그, 순위 계산 방식, 경험치(XP)와 레벨.",
      catStreamerDesc: "채널 소유권 인증, 스트리머 랭킹 자격, Featured Streamer 기준.",
      catPolicyTitle: "정책",
      catPolicyDesc: "이용약관과 개인정보 처리방침을 확인하세요.",
    },
    wikiBody: {
      streamer: {
        title: "Streamer 개요",
        description:
          "공식 OAuth/API로 채널 소유권을 검증한 스트리머/유튜버를 OwOGG Streamer로 인정합니다.",
        intro:
          "Streamer 인증은 게임 점수나 XP에 어떤 가산점도 주지 않습니다. 대신 명예의 전당의 스트리머 랭킹 탭 노출, 내 프로필의 검증 배지와 공식 채널 링크 표시라는 혜택을 제공합니다.",
        cardVerification: "채널 소유권 인증 →",
        cardVerificationDesc: "지원 플랫폼과 인증 방법",
        cardFeatured: "Featured Streamer →",
        cardFeaturedDesc: "Featured 자격 기준",
        profileHint: "인증은 내 프로필 페이지에서 시작할 수 있습니다.",
        profileLink: "내 프로필로 이동",
      },
      streamerVerification: {
        title: "채널 소유권 인증",
        description:
          "공식 OAuth와 API만으로 소유권을 검증합니다. 텍스트 입력이나 스크래핑은 절대 사용하지 않습니다.",
        platformsHeading: "지원 플랫폼",
        conditionsHeading: "인증 조건",
        condOnePrefix: "위 4개 플랫폼(YouTube · CHZZK · SOOP · Twitch) 중 ",
        condOneStrong: "단 하나만",
        condOneSuffix:
          " 인증에 성공하면 OwOGG Streamer로 인정되며, 4개를 모두 인증할 필요는 없습니다.",
        condNoMinimum:
          "현재 구독자/팔로워 수나 채널 개설 기간에 대한 최소 기준은 요구하지 않습니다. 채널 소유권만 공식 OAuth로 확인되면 됩니다.",
        condOauthOnly:
          "소유권 인증은 항상 각 플랫폼의 공식 OAuth 로그인 화면을 통해서만 이루어지며, 채널 URL이나 닉네임을 직접 입력하는 방식은 지원하지 않습니다.",
        condOneChannelOneAccount:
          "하나의 외부 채널은 한 OwOGG 계정에만 연동할 수 있습니다(1채널 = 1계정).",
        methodHeading: "인증 방법",
        step1: "내 프로필 페이지의 [스트리머 채널 소유권 인증] 섹션으로 이동합니다.",
        step2: "인증하려는 플랫폼의 [채널 소유권 인증] 버튼을 클릭합니다.",
        step3: "해당 플랫폼의 공식 로그인 화면에서 본인 계정으로 로그인·승인합니다.",
        step4: "OwOGG로 돌아오면 채널 정보가 자동으로 확인되어 표시됩니다.",
        calloutLoginStrong: "OwOGG 로그인과 채널 인증은 별개입니다.",
        calloutLoginBody:
          " Google로 로그인했다고 해서 자동으로 YouTube 채널이 연동되지 않습니다 — 명시적인 인증 절차를 거쳐야 합니다.",
        calloutDuplicate:
          "하나의 외부 채널은 한 OwOGG 계정에만 연동될 수 있습니다. 이미 다른 사용자가 인증한 채널은 다시 인증할 수 없습니다.",
        footerPrefix: "스트리머 랭킹에 노출되려면 위 4개 플랫폼 중 ",
        footerStrong: "하나만",
        footerMid: " 인증하면 충분합니다. 자세한 자격 조건은 ",
        footerLink: "랭킹 문서",
        footerSuffix: "를 참고하세요.",
      },
      streamerFeatured: {
        title: "Featured Streamer",
        description: "Featured는 OwOGG 기준 공개 채널 지표로 심사하는 표시·필터링 전용 배지입니다.",
        conceptHeading: "개념 구분",
        conceptStreamerTerm: "Streamer",
        conceptStreamerDesc: " — 공식 OAuth/API로 채널 소유권이 검증된 상태.",
        conceptFeaturedTerm: "Featured Streamer",
        conceptFeaturedDesc:
          " — Streamer 중에서 OwOGG 기준(구독자/팔로워, 채널 개설 기간 등 공개 지표)을 충족해 자동/수동 심사를 통과한 상태.",
        reviewHeading: "심사 방식",
        reviewBody:
          "채널 소유권 인증 직후에는 Featured가 즉시 부여되지 않습니다. 일정 시간 뒤 신선한 공식 지표로 자동 재심사가 이루어지며, 지표가 모호하거나 플랫폼이 공식 API로 지표를 제공하지 않으면 운영진 수동 심사로 안전하게 넘어갑니다. Featured로 인정된 이후에도 주기적으로 재검증합니다.",
        calloutNoRankImpactStrong: "Featured는 점수·XP·랭킹 순위에 영향을 주지 않습니다.",
        calloutNoRankImpactBody:
          " 표시 전용 배지이며, Featured 여부와 무관하게 스트리머 랭킹은 채널 소유권 인증만으로 노출됩니다.",
        calloutTestingPhase:
          "현재는 서비스 검증 단계라 Featured가 자동으로 부여되지 않고, 채널 소유권이 인증된 모든 Streamer가 운영진 수동 심사 대기 상태를 거칩니다. 스트리머 랭킹에는 Featured 여부와 무관하게 동일하게 노출되며, Featured 배지도 아직 공개적으로 표시하지 않습니다.",
        footerNote:
          "운영진의 심사 기준과 절차는 내부 운영 문서로 별도 관리되며, 특정 수치를 공개하지 않습니다 — 심사는 항상 공식 API로 확인 가능한 지표만 사용합니다.",
      },
      account: {
        title: "계정 개요",
        description:
          "OwOGG는 Google과 Discord 로그인을 지원하며, 두 방식은 기본적으로 별도 계정입니다.",
        loginHeading: "로그인 방식",
        loginBody:
          "Google 또는 Discord로 로그인할 수 있습니다. 같은 사람이더라도 Google로 만든 계정과 Discord로 만든 계정은 기본적으로 서로 다른 OwOGG 계정입니다 — 자동으로 합쳐지지 않습니다.",
        profileHeading: "프로필 설정",
        profileBody:
          "내 프로필 페이지에서 닉네임과 국가/지역을 설정할 수 있고, 레벨·XP·업적·즐겨찾기·최근 플레이 기록을 확인할 수 있습니다.",
        profileLink: "내 프로필로 이동 →",
        calloutPrefix: "Google과 Discord 계정을 따로 만들었다면 ",
        calloutLink: "계정 통합",
        calloutSuffix: " 기능으로 하나로 합칠 수 있습니다.",
      },
      accountMerge: {
        title: "계정 통합",
        description: "Primary Account Wins 방식 — 남길 계정(Primary)을 먼저 선택하고 진행합니다.",
        howHeading: "통합 방식: Primary Account Wins",
        howBodyPrefix: "두 계정 중 계속 사용할 계정을 ",
        howBodyPrimary: "Primary",
        howBodySuffix:
          "로 지정합니다. 통합이 완료되면 Primary의 게임 기록·XP·개인화 설정이 그대로 유지되고, Secondary의 해당 데이터는 합쳐지지 않고 정리됩니다. Secondary에 연결되어 있던 Google/Discord 로그인 수단만 Primary로 옮겨져, 이후에는 어느 수단으로 로그인해도 같은 Primary 계정으로 들어오게 됩니다.",
        stepsHeading: "진행 순서",
        step1: "계속 사용할 계정(Primary)으로 로그인합니다.",
        step2: "계정 통합을 시작하고, 합칠 대상 계정(Secondary)으로 본인 확인을 진행합니다.",
        step3: "통합 내용을 확인합니다 — Secondary의 게임/개인화 데이터는 유지되지 않습니다.",
        step4: "확인 후 통합을 확정합니다.",
        step5: "이후 Secondary였던 로그인 수단으로도 Primary 계정에 로그인됩니다.",
        calloutNoMergeStrong: "기록은 합쳐지지 않습니다.",
        calloutNoMergeBody:
          " Primary의 점수/XP/진행도만 유지되며, Secondary의 기록은 통합 후 사라집니다 — 반드시 남기고 싶은 계정을 Primary로 선택하세요.",
        calloutAdminStrong: "Secondary 계정이 관리자 계정이면 통합이 차단됩니다.",
        calloutAdminBody:
          " 관리자 권한이 있는 계정을 Secondary로 통합하면 그 권한이 어디로도 옮겨지지 않고 사라질 수 있어, OwOGG는 안전을 위해 이 경우 통합 자체를 막고 운영진의 별도 처리를 요구합니다.",
        footerPrefix: "플랫폼 소유권 인증(Streamer)이 되어 있는 계정을 통합하는 경우의 규칙은 ",
        footerLink: "Streamer 채널 소유권 인증",
        footerSuffix: " 문서를 참고하세요.",
      },
      games: {
        title: "게임과 랭킹 개요",
        description:
          "OwOGG는 반응속도, 순서 기억력, 에임, 타자 속도 등 미니게임 카탈로그를 제공합니다.",
        intro:
          "각 게임은 독립적인 규칙과 점수 방식을 가지며, 유효한 기록은 자동으로 랭킹에 반영됩니다. 플레이와 별개로 활동 자체는 경험치(XP)로도 누적됩니다.",
        cardRanking: "랭킹 →",
        cardRankingDesc: "게임별/스트리머 랭킹 계산 방식",
        cardXp: "XP와 레벨 →",
        cardXpDesc: "경험치 지급 방식과 레벨 공식",
        cardDevelopment: "게임 개발 및 등록 →",
        cardDevelopmentDesc: "게임 크리에이터가 되어 직접 게임을 올리는 방법",
        footerPrefix: "지금 바로 ",
        footerLink: "게임 카탈로그",
        footerSuffix: "에서 플레이해보세요.",
      },
      gamesDevelopment: {
        title: "게임 개발 및 등록",
        description: "누구나 만든 웹 게임을 게임 크리에이터로 OwOGG에 올릴 수 있습니다.",
        intro:
          "웹으로 빌드되는 것이면 장르 제약 없이 올릴 수 있습니다 — 슈터, 퍼즐, 캐주얼, 액션, 무엇이든 좋습니다. 유일한 조건은 결과물이 index.html을 진입점으로 갖는 정적 웹 파일 묶음이어야 한다는 것입니다.",
        eligibilityHeading: "게임 크리에이터 자격 얻기",
        eligibilityBody:
          "게임을 업로드하려면 먼저 게임 크리에이터 자격이 필요합니다. 운영팀이 직접 임명하는 방식으로 운영되고 있으며, 셀프서비스 신청 기능은 현재 준비 중입니다(추후 업데이트 예정). 자격이 필요하면 운영팀에 문의해주세요.",
        eligibilityLink: "게임 크리에이터 센터 확인하기",
        sdkHeading: "호스트 연동 — 2줄이면 충분",
        sdkBody:
          "게임이 OwOGG 호스트에게 알려야 할 건 '로딩 끝남'과 '게임 종료 + 점수' 두 가지뿐입니다.",
        limitsHeading: "용량 제한",
        limitBundle: "ZIP 1개당 최대 20MiB (업로드 시점 압축 크기 기준)",
        limitExtracted: "압축을 풀었을 때 총 50MiB 이하",
        limitFiles: "파일 개수 300개 이하",
        flowHeading: "제출 → 심사 → 공개",
        flowStep1:
          "업로드: 게임 크리에이터 센터에서 owogg.json이 포함된 ZIP을 끌어다 놓으면 게임 등록과 업로드가 한 번에 끝납니다. 업로드 직후는 본인에게만 보입니다.",
        flowStep2:
          "심사: 운영팀이 실제로 플레이해보고 콘텐츠를 확인합니다. 승인되어도 자동으로 공개되지 않습니다.",
        flowStep3:
          "공개: 운영팀이 별도로 공개 전환해야 그 순간부터 실제 유저에게 서비스가 시작됩니다.",
        policyHeading: "콘텐츠 정책",
        policyBody:
          "불법 콘텐츠, 혐오/차별 표현, 성인 콘텐츠, 타인의 IP를 침해하는 에셋/텍스트, 악성 코드나 다른 유저에게 피해를 주는 로직은 금지됩니다.",
        footerPrefix: "자세한 업로드 절차는 ",
        footerLink: "게임 크리에이터 센터",
        footerSuffix: "에서 직접 확인하세요.",
      },
      gamesRanking: {
        title: "랭킹",
        description:
          "명예의 전당(/ranking)은 일반 랭킹과 스트리머 랭킹을 같은 화면 구조로 제공합니다. 각 범위에서 게임 기록, XP, 연속 출석을 선택할 수 있습니다.",
        gameHeading: "일반 랭킹",
        gameBody:
          "게임 기록과 XP는 KST 기준 일간·주간·월간으로 나누며, 게임 기록은 해당 기간의 사용자별 최고 기록 1건만 반영합니다. 연속 출석은 현재 유효한 일수를 표시합니다.",
        xpHeading: "기간·달성일 기준",
        xpBodyPrefix: "각 행에는 순위 값을 달성한 년·월·일이 표시됩니다. XP 지급 방식은 ",
        xpBodyLink: "XP와 레벨 문서",
        xpBodySuffix: "를 참고하세요.",
        streamerHeading: "스트리머 랭킹",
        streamerBodyPrefix: "YouTube / CHZZK / SOOP / Twitch 중 ",
        streamerBodyStrong: "하나 이상",
        streamerBodySuffix:
          "의 플랫폼에서 공식 채널 소유권 인증을 완료한 사용자만 노출됩니다. 게임 기록·XP·연속 출석은 일반 랭킹과 동일한 계산식과 UI를 사용하며, 인증 플랫폼 수는 순위에 영향을 주지 않습니다.",
        streamerLinkPrefix: "자세한 인증 방법은 ",
        streamerLink: "Streamer 채널 소유권 인증",
        streamerLinkSuffix: " 문서를 참고하세요.",
        calloutFeatured:
          "Featured Streamer 표시는 랭킹 순위나 XP 계산에 어떠한 영향도 주지 않는 표시 전용 배지입니다.",
        footerPrefix: "Discord 서버 단위 랭킹은 ",
        footerLink: "Discord 서버 XP 문서",
        footerSuffix: "를 참고하세요.",
      },
      gamesXp: {
        title: "XP와 레벨",
        description:
          "게임을 유효하게 완료할 때마다 경험치가 쌓이고, 누적 경험치에 따라 레벨이 오릅니다.",
        grantHeading: "XP 지급",
        grantPerPlay: "인정되는 게임 완료 1회당 10 XP가 지급됩니다.",
        grantDailyCap: "같은 게임은 하루(UTC 기준) 최대 10회까지만 XP가 지급됩니다.",
        grantAfterCap:
          "상한에 도달해도 게임 플레이 자체는 계속 가능합니다 — 추가 XP만 지급되지 않습니다.",
        formulaHeading: "레벨 공식",
        formulaPrefix: "레벨 L에 도달하기 위한 누적 XP는 ",
        formulaSuffix: "입니다. 레벨이 오를수록 다음 레벨까지 필요한 XP가 점점 늘어납니다.",
        calloutPrefix: "Discord 서버에서 만든 XP와 글로벌 XP의 관계가 궁금하다면 ",
        calloutLink: "Discord 서버 XP 문서",
        calloutSuffix: "를 확인하세요.",
        footerPrefix: "내 레벨과 XP는 ",
        footerProfileLink: "내 프로필",
        footerMid: "에서, 전체 순위는 ",
        footerRankingLink: "명예의 전당",
        footerSuffix: "에서 확인할 수 있습니다.",
      },
      gettingStarted: {
        title: "시작하기",
        description: "가장 빠르게 첫 게임을 플레이하고 기록을 남기는 방법입니다.",
        flowHeading: "기본 흐름",
        step1: "OwOGG 계정으로 로그인합니다 (Google 또는 Discord).",
        step2: "게임 카탈로그에서 원하는 미니게임을 선택합니다.",
        step3: "게임을 플레이하고 결과를 확인합니다 — 유효한 기록은 자동으로 저장됩니다.",
        step4: "명예의 전당(랭킹)에서 나의 순위와 XP를 확인합니다.",
        step5: "필요하다면 Discord를 연결해 서버 친구들과 경쟁합니다.",
        calloutGuest:
          "게스트로도 게임을 플레이할 수 있습니다. 다만 기록이 계정에 저장되고 랭킹/XP에 반영되려면 로그인이 필요합니다.",
        cardCatalog: "게임 카탈로그 →",
        cardCatalogDesc: "지금 플레이할 게임 고르기",
        cardRanking: "명예의 전당 →",
        cardRankingDesc: "게임/XP/스트리머 랭킹 확인",
        footerPrefix: "Discord 서버에서 친구들과 함께 하고 싶다면 ",
        footerDiscordLink: "Discord 문서",
        footerMid: "를, 계정 설정은 ",
        footerAccountLink: "계정 문서",
        footerSuffix: "를 확인하세요.",
      },
      discordOverview: {
        title: "Discord 개요",
        description:
          "OwOGG는 상시 접속 봇이 아니라 서명된 HTTP Interactions로 동작합니다. 설치, 계정 연결, 서버 등록은 서로 다른 3단계입니다.",
        calloutStrong:
          "일반 사용자는 Bot Token, Application ID, Public Key를 다룰 필요가 없습니다.",
        calloutBody: " 이 값들은 OwOGG 운영진만 GitHub Actions Secret으로 관리합니다.",
        flowHeading: "전체 흐름",
        step1: "Discord에 OwOGG 앱을 추가합니다 (서버 관리자 권한 필요).",
        step2: "선택한 서버를 확인하고 승인합니다.",
        step3: "OwOGG로 돌아와 Discord 계정을 연결합니다.",
        step4: "관리 권한이 있는 서버를 OwOGG 커뮤니티로 등록합니다.",
        step5: "Discord에서 /owogg games, /owogg play로 시작합니다.",
        cardInstall: "설치하기 →",
        cardInstallDesc: "서버에 앱을 추가하는 방법",
        cardServerReg: "서버 등록 →",
        cardServerRegDesc: "PUBLIC/UNLISTED/PRIVATE 선택",
        cardCommands: "명령어 →",
        cardCommandsDesc: "/owogg 전체 서브커맨드",
        cardTroubleshooting: "문제 해결 →",
        cardTroubleshootingDesc: "자주 발생하는 증상별 해결법",
        footerPrefix: "지금 바로 설치를 시작하려면 ",
        footerLink: "5단계 설치 가이드",
        footerSuffix: "를 이용하세요.",
      },
      discordInstall: {
        title: "Discord에 OwOGG 설치하기",
        description:
          "Discord 앱 설치는 OwOGG를 서버에서 사용할 준비 단계입니다. 서버 등록과는 별개입니다.",
        calloutStrong: "일반 사용자는 Bot Token을 입력할 필요가 없습니다.",
        calloutBody:
          " 아래 공식 설치 링크를 클릭하고 Discord의 서버 선택/승인 화면만 따라가면 됩니다.",
        checklistPrefix: "설치부터 계정 연결, 서버 등록까지 진행 상황을 실시간으로 확인하려면 ",
        checklistLink: "5단계 설치 가이드",
        checklistSuffix: "를 이용하세요.",
        buttonLabel: "Discord에 OwOGG 추가",
        loadingPrefix: "설치 링크를 불러오는 중이거나 아직 준비되지 않았습니다.",
        loadingLink: "설치 가이드",
        loadingSuffix: "에서 다시 확인해보세요.",
        calloutWarningStrong: "앱 설치 ≠ OwOGG 서버 등록입니다.",
        calloutWarningBodyPrefix:
          " 앱을 설치해도 서버가 자동으로 OwOGG 디렉토리에 게시되지 않습니다. 관리자가 ",
        calloutWarningLink: "서버 등록",
        calloutWarningSuffix: "을 별도로 완료해야 합니다.",
        footerPrefix: "설치 후 다음 단계는 ",
        footerLink: "계정 연결",
        footerSuffix: "입니다.",
      },
      discordAccountLink: {
        title: "계정 연결",
        description:
          "Discord 계정을 OwOGG 계정과 연결하면 봇 명령어(/owogg profile, /owogg play 등)에서 본인 정보를 사용할 수 있습니다.",
        methodHeading: "연결 방법",
        step1: "Discord 서버에서 /owogg link 명령어를 입력합니다.",
        step2: "봇이 나에게만 보이는(ephemeral) 1회용 연결 링크를 응답합니다.",
        step3: "그 링크를 클릭해 OwOGG 웹으로 이동합니다.",
        step4: "OwOGG에 로그인되어 있지 않다면 먼저 로그인합니다.",
        step5: "연결 확인 화면에서 승인하면 완료됩니다.",
        calloutPrefix:
          "연결 링크는 1회용이며 일정 시간 후 만료됩니다. 만료되었거나 이미 사용한 링크라면 Discord에서 ",
        calloutCode: "/owogg link",
        calloutSuffix: "를 다시 실행해 새 링크를 받으세요.",
        calloutWarning:
          "하나의 Discord 계정은 최초 등록된 하나의 OwOGG 계정에만 연결됩니다. 연결을 해제해도 등록 소유권은 유지되며 다른 계정으로 옮길 수 없습니다.",
        footerPrefix: "연결에 실패하나요? ",
        footerLink1: "문제 해결 가이드",
        footerMid: "를 확인하세요. 또는 웹에서 바로 ",
        footerLink2: "계정 연결 페이지",
        footerSuffix: "를 열 수 있습니다.",
      },
      discordServerRegistration: {
        title: "서버 등록",
        description:
          "앱 설치와 서버 등록은 별개입니다. 서버 등록을 완료해야 서버 XP·리더보드·서버 전용 페이지가 활성화됩니다.",
        requirementsHeading: "등록 요건",
        req1: "OwOGG 계정으로 로그인되어 있어야 합니다.",
        req2: "등록하려는 Discord 서버에서 서버 관리(Manage Server) 권한이 있어야 합니다.",
        req3: "OwOGG 앱이 해당 서버에 이미 설치되어 있어야 합니다.",
        stepsHeading: "등록 순서",
        step1: "OwOGG에 로그인한 상태로 Discord 서버 등록 인증을 시작합니다.",
        step2: "Discord가 요청하는 권한(서버 목록 확인)을 승인합니다.",
        step3: "관리 가능한 서버 목록에서 등록할 서버를 선택합니다.",
        step4: "서버 slug(URL 이름)와 소개, 공개 범위를 설정합니다.",
        step5: "등록을 완료하면 서버 전용 페이지가 즉시 생성됩니다.",
        buttonLabel: "서버 등록 시작하기",
        visibilityHeading: "공개 범위 (Visibility)",
        visibilityPublicDesc: "OwOGG 서버 디렉토리와 검색에 노출됩니다.",
        visibilityUnlistedDesc: "직접 링크로만 접근 가능하며 디렉토리에는 노출되지 않습니다.",
        visibilityPrivateDesc: "서버 관리자만 접근 가능합니다.",
        calloutStrong: "앱 설치 ≠ 서버 등록.",
        calloutBody:
          " 앱을 설치했다고 해서 서버가 자동으로 공개되지 않습니다. 반드시 위 절차로 직접 등록해야 합니다.",
        footerPrefix: "서버가 목록에 없다면 ",
        footerLink: "문제 해결 가이드",
        footerSuffix: '의 "서버가 등록 후보에 없습니다" 항목을 확인하세요.',
      },
      discordCommands: {
        title: "명령어",
        description: "모든 OwOGG Discord 명령어는 /owogg의 서브커맨드입니다.",
        calloutEphemeral:
          "표시된 응답은 명령어를 실행한 사용자에게만 보이는 임시(ephemeral) 메시지입니다 — 채널의 다른 사람에게는 보이지 않습니다.",
        labelWhere: "사용 위치",
        labelAccountLink: "계정 연결 필요",
        labelGuildRequired: "서버 등록 필요",
        labelArgs: "인자",
        labelExample: "예시",
        labelCommonError: "흔한 오류: ",
        yes: "예",
        no: "아니요",
        footerPrefix: "예상과 다르게 동작하나요? ",
        footerLink: "문제 해결 가이드",
        footerSuffix: "를 확인하세요.",
        commands: [
          {
            purpose: "이 Discord 계정을 OwOGG 계정과 연결합니다.",
            where: "서버 채널 또는 DM",
            args: "없음",
            commonError: "이미 연결되어 있으면 새 링크 대신 안내 메시지만 옵니다.",
          },
          {
            purpose: "연결된 OwOGG 계정의 닉네임, 레벨, 총 XP를 확인합니다.",
            where: "서버 채널 또는 DM",
            args: "없음",
            commonError: "계정이 연결되지 않았으면 /owogg link 안내가 옵니다.",
          },
          {
            purpose: "현재 OwOGG에서 플레이 가능한 게임 목록과 링크를 확인합니다.",
            where: "서버 채널 또는 DM, 로그인 불필요",
            args: "없음",
            commonError: "없음 (항상 공개적으로 응답)",
          },
          {
            purpose: "이 서버에 XP가 귀속되는 1회용 게임 플레이 링크를 발급합니다.",
            where: "등록된 서버 채널",
            args: "game (선택) — 특정 게임을 지정, 생략 시 게임 목록으로 이동",
            commonError:
              "서버가 미등록이거나 계정 미연결 시 안내 메시지가 옵니다. 링크는 15분간 1회만 유효합니다.",
          },
          {
            purpose: "이 서버 내 나의 순위와 서버 기여 XP를 확인합니다.",
            where: "등록된 서버 채널",
            args: "없음",
            commonError: "계정 미연결 또는 이 서버에서 아직 활동이 없으면 안내 메시지가 옵니다.",
          },
          {
            purpose: "이 서버의 OwOGG XP 리더보드 Top 10을 확인합니다.",
            where: "등록된 서버 채널",
            args: "없음",
            commonError: "서버가 미등록이면 안내 메시지가 옵니다.",
          },
          {
            purpose: "이 서버의 전체 XP와 주간 활동 요약을 확인합니다.",
            where: "등록된 서버 채널",
            args: "없음",
            commonError: "서버가 미등록이면 안내 메시지가 옵니다.",
          },
        ],
      },
      discordXp: {
        title: "서버 XP가 계산되는 방식",
        description: "글로벌 XP, 서버별 사용자 XP, 서버 활동 XP는 서로 다른 세 가지 숫자입니다.",
        differHeading: "세 가지 XP는 다릅니다",
        globalTerm: "일반 OwOGG XP (글로벌)",
        globalDesc: " — 계정 전체의 누적 경험치. 프로필/전체 랭킹에 사용됩니다.",
        perGuildTerm: "Discord 서버별 사용자 XP",
        perGuildDescPrefix: " — 그 서버에서 ",
        perGuildDescCode: "/owogg play",
        perGuildDescSuffix: "로 만든 유효한 완료만 누적됩니다.",
        guildActivityTerm: "Discord 서버 활동 XP",
        guildActivityDesc:
          " — 서버 구성원 전체가 기여한 합계로, 서버 리더보드/주간 랭킹에 사용됩니다.",
        exampleHeading: "예시",
        exampleBodyPrefix: "Global XP가 25,000인 사용자가 새로 등록된 Guild A에서 ",
        exampleBodyCode: "/owogg play",
        exampleBodySuffix: "로 유효한 완료 1회(+10)를 만들면:",
        cardGlobalTitle: "글로벌 XP",
        cardGlobalText: "계정 전체 누적",
        cardGuildATitle: "Guild A 사용자 XP",
        cardGuildAText: "A에서 만든 유효한 기여",
        cardGuildBTitle: "Guild B",
        cardGuildBText: "기존 XP가 자동 복사되지 않음",
        calloutNoCopyStrong: "기존 글로벌 XP는 새 서버에 자동으로 복사되지 않습니다.",
        calloutNoCopyBody:
          " 새로 등록된 서버는 항상 0에서 시작하며, 오직 그 서버에서 만든 새로운 유효한 플레이만 쌓입니다.",
        calloutAbuseStrong: "어뷰징 방지:",
        calloutAbuseBody:
          " 사용자 × 게임 × UTC 하루 기준 글로벌 XP 지급은 최대 10회입니다. 상한에 도달하면 게임 완료 자체는 계속 가능하지만 추가 XP는 지급되지 않습니다. 하나의 플레이 이벤트는 최대 하나의 서버에만 귀속됩니다 — 같은 완료가 여러 서버에 중복으로 XP를 만들지 않습니다.",
        footerPrefix: "서버 랭킹 보는 방법은 ",
        footerLink: "게임과 랭킹 문서",
        footerSuffix: "를 참고하세요.",
      },
      discordTroubleshooting: {
        title: "문제 해결",
        description:
          "증상으로 찾아보세요. 어떤 경우에도 일반 사용자가 Bot Token을 설정할 필요는 없습니다.",
        calloutWarning:
          "아래 어떤 증상도 Bot Token, Application ID, Public Key 입력을 요구하지 않습니다. 그런 안내를 받았다면 공식 OwOGG 채널이 아닐 수 있습니다.",
        faqAutocomplete: {
          question: "/owogg가 자동완성에 안 나옵니다",
          answerPrefix:
            "Discord 클라이언트를 재시작하거나 서버를 나갔다가 다시 들어와 보세요. 그래도 안 나오면 앱이 이 서버에 실제로 설치되어 있는지 서버 관리자에게 확인을 요청하세요. OwOGG 운영진 쪽에서는 ",
          answerCode: "pnpm discord:commands:check",
          answerSuffix: "로 전역 명령어 등록 상태를 확인할 수 있습니다.",
        },
        faqPlainMessage: {
          question: "/owogg link를 입력했는데 일반 메시지로 올라갑니다",
          answer:
            "정상적인 슬래시 명령어 대신 일반 텍스트로 전송됐다면 Discord가 명령어를 인식하지 못한 것입니다. 자동완성 목록에서 정확히 /owogg를 선택한 뒤 하위 명령어를 선택해서 실행해야 합니다. 직접 타이핑해서 전송하면 일반 메시지가 됩니다.",
        },
        faqNoResponse: {
          question: "애플리케이션이 응답하지 않았습니다",
          answer:
            "일시적인 지연이나 오류일 수 있습니다. 잠시 후 다시 시도하세요. 반복되면 OwOGG 서비스 상태에 문제가 있을 수 있으니 잠시 후 다시 확인해주세요.",
        },
        faqAlreadyLinked: {
          question: "계정이 이미 연결되어 있다고 합니다",
          answer:
            "이 Discord 계정이 이미 다른 OwOGG 계정에 등록되어 있다는 뜻입니다. 하나의 Discord 계정은 최초 등록된 OwOGG 계정에 계속 귀속되며, 연결을 해제해도 다른 계정으로 재등록할 수 없습니다.",
        },
        faqServerNotRegistered: {
          question: "/owogg play가 서버 미등록이라고 합니다",
          answerPrefix:
            "이 Discord 서버가 아직 OwOGG 커뮤니티로 등록되지 않았습니다. 서버 관리자가 ",
          answerLink: "서버 등록",
          answerSuffix: "을 완료해야 합니다. 앱 설치만으로는 등록되지 않습니다.",
        },
        faqNotInCandidateList: {
          question: "서버가 등록 목록(등록 후보)에 없습니다",
          answer:
            "등록 가능한 서버 목록은 실제로 서버 관리(Manage Server) 권한이 있는 서버만 표시됩니다. 권한이 없거나, 로그인한 Discord 계정이 원하는 서버 계정이 아닌지 확인하세요.",
        },
        faqBotNotVisible: {
          question: "봇이 Discord 멤버 목록에서 보이지 않습니다",
          answer:
            'OwOGG는 상시 접속(Gateway) 봇이 아니라 서명된 HTTP Interactions 방식으로 동작합니다. 그래서 멤버 목록에 항상 "온라인"으로 표시되지 않을 수 있습니다 — 이는 정상이며 명령어 작동에는 영향이 없습니다.',
        },
        faqBotOffline: {
          question: "봇이 오프라인으로 보입니다",
          answer:
            "위와 같은 이유입니다. HTTP Interactions 기반 앱은 상시 접속 상태를 유지하지 않으므로 Discord 멤버 목록에서 오프라인으로 표시될 수 있습니다. 명령어가 정상적으로 실행된다면 문제가 아닙니다.",
        },
        footerPrefix: "여기에 없는 문제인가요? ",
        footerLink: "Discord 이용 가이드",
        footerSuffix: "의 FAQ도 확인해보세요.",
      },
      support: {
        title: "문의 · 신고 · 버그 제보",
        description: "상황에 맞는 채널로 연락해주시면 더 빠르게 도와드릴 수 있어요.",
        generalHeading: "일반 문의 (contact@owogg.com)",
        generalBody: "계정 문제, 사용 방법, 기능 제안 등 그 외 모든 문의사항을 보내주세요.",
        reportHeading: "신고하기 (report@owogg.com)",
        reportBody:
          "부정행위, 어뷰징, 부적절한 콘텐츠 등 커뮤니티 가이드라인 위반 사항을 신고해주세요.",
        bugHeading: "버그 제보 (bug@owogg.com)",
        bugBody:
          "게임 오류, 기능 오작동, 화면 깨짐 등 기술적인 문제를 알려주세요. 어떤 게임/페이지에서, 어떤 상황에서 발생했는지 함께 적어주시면 더 빠르게 확인할 수 있어요.",
        tipsHeading: "공통 팁",
        tip1: "가능하면 스크린샷을 함께 첨부해주세요.",
        tip2: "계정 관련 문의는 가입에 사용한 이메일 또는 닉네임을 알려주세요.",
        tip3: "신고는 대상(닉네임/게시물 등)과 구체적인 상황을 함께 적어주세요.",
        footerPrefix: "한 곳에서 모든 채널을 확인하고 바로 메일을 보내려면 ",
        footerLink: "문의하기 페이지",
        footerSuffix: "를 이용해보세요.",
      },
    },
    legal: {
      terms: {
        metaTitle: "이용약관",
        metaDescription: "OwOGG 서비스 이용약관",
        pageTitle: "이용약관",
        effectiveDate: "시행일: 2026년 8월 14일",
        section1Heading: "1. 서비스 개요",
        section1Body:
          'OwOGG(이하 "서비스")는 설치 없이 브라우저에서 바로 즐기는 웹 미니게임 모음 플랫폼이며, Discord 서버 연동, 랭킹/경험치(XP), Streamer 채널 인증 등 부가 기능을 함께 제공합니다.',
        section2Heading: "2. 계정 및 로그인",
        section2Body:
          "서비스는 Google 또는 Discord 계정을 통한 OAuth 로그인만 지원하며, 별도의 아이디/비밀번호를 직접 발급하지 않습니다(관리자 전용 계정 제외). 이용자는 본인이 소유한 계정으로만 로그인해야 하며, 계정 관리에 대한 책임은 이용자 본인에게 있습니다.",
        section3Heading: "3. 이용자의 의무",
        section3Intro: "이용자는 다음 행위를 해서는 안 됩니다.",
        section3List: [
          "자동화 도구, 매크로 등을 이용해 게임 기록이나 경험치를 부정하게 조작하는 행위",
          "본인이 소유하지 않은 계정, 채널, Discord 서버를 마치 본인 소유인 것처럼 등록하거나 인증하는 행위",
          "타인의 개인정보를 무단으로 수집·게시하거나 서비스를 통해 타인에게 피해를 주는 행위",
          "서비스의 정상적인 운영을 방해하는 공격, 과도한 요청, 취약점 악용 행위",
        ],
        section4Heading: "4. 콘텐츠 및 게임 기록",
        section4Body:
          "이용자가 생성한 게임 기록, 닉네임, 프로필 정보는 랭킹/XP 등 서비스 제공 목적으로 사용됩니다. 서비스는 부정 기록으로 판단되는 데이터를 사전 통지 없이 조정하거나 삭제할 수 있습니다.",
        section5Heading: "5. 서비스 변경 및 중단",
        section5Body:
          "서비스는 운영상·기술상 필요에 따라 제공하는 게임, 기능, 화면 구성을 예고 없이 변경하거나 중단할 수 있습니다. 서비스는 무료로 제공되며, 가용성이나 특정 성능을 보장하지 않습니다.",
        section6Heading: "6. 면책조항",
        section6Body:
          "서비스는 무료로 제공되는 개인/소규모 프로젝트로, 관련 법령이 허용하는 범위에서 서비스 이용과 관련하여 발생하는 손해에 대해 책임을 지지 않습니다. 다만 고의 또는 중과실로 인한 손해는 예외로 합니다.",
        section7Heading: "7. 약관의 변경",
        section7Body:
          "본 약관은 필요시 개정될 수 있으며, 개정 시 이 페이지를 통해 고지합니다. 개정된 약관은 게시와 동시에 효력이 발생합니다.",
        section8Heading: "8. 문의",
        section8BodyPrefix: "서비스 이용과 관련한 문의는 ",
        section8BodyEmail: "contact@owogg.com",
        section8BodySuffix: "으로 연락해 주세요.",
      },
      privacy: {
        metaTitle: "개인정보 처리방침",
        metaDescription: "OwOGG 개인정보 처리방침",
        pageTitle: "개인정보 처리방침",
        effectiveDate: "시행일: 2026년 8월 14일",
        section1Heading: "1. 수집하는 개인정보 항목",
        section1Intro: "OwOGG는 서비스 제공을 위해 아래 정보만 수집합니다.",
        section1List: [
          {
            term: "로그인 정보",
            desc: " — Google 또는 Discord 계정으로 로그인 시 제공되는 이메일, 닉네임(표시 이름), 프로필 사진 URL, 계정 고유 식별자(sub/ID)",
          },
          {
            term: "게임 이용 기록",
            desc: " — 게임별 점수/기록, 경험치(XP), 레벨, 도전과제 달성 내역",
          },
          {
            term: "프로필 설정",
            desc: " — 이용자가 직접 입력하는 닉네임, 국가/지역(선택, 자기 신고 정보이며 국적 인증이 아님)",
          },
          {
            term: "Discord 연동 정보",
            desc: " — 계정 연동 시 Discord 사용자 ID, 서버(길드) 등록 시 서버 ID/이름/아이콘, 관리 권한 여부",
          },
          {
            term: "Streamer 채널 인증 정보",
            desc: " — 스트리머 랭킹 참여를 위해 자발적으로 채널 소유권 인증을 진행한 경우, 해당 플랫폼(YouTube/Twitch/CHZZK/SOOP)의 공식 API를 통해 확인된 채널명, 채널 URL, 구독자/팔로워 수",
          },
        ],
        section1Outro:
          "비밀번호는 별도로 수집하지 않습니다(관리자 전용 계정은 예외이며, 해당 비밀번호는 PBKDF2로 해시되어 저장되고 평문으로 보관되지 않습니다).",
        section2Heading: "2. 수집 목적",
        section2List: [
          "회원 식별 및 로그인 상태 유지",
          "게임 기록·랭킹·경험치 시스템 제공",
          "Discord 봇 명령어에서 본인 계정 정보 조회, 서버별 활동 집계",
          "Streamer/스트리머 랭킹 자격 확인",
          "부정 이용(어뷰징) 탐지 및 서비스 안정성 유지",
        ],
        section3Heading: "3. 보관 기간",
        section3Body:
          "개인정보는 회원 탈퇴 시 또는 이용자의 삭제 요청 시까지 보관하며, 관련 법령에서 별도 보관을 요구하는 경우 그에 따릅니다.",
        section4Heading: "4. 제3자 제공",
        section4Body:
          "OwOGG는 이용자의 개인정보를 광고, 마케팅 등 목적으로 제3자에게 제공하거나 판매하지 않습니다. 서비스 운영에 필요한 인프라(Cloudflare — 서버/데이터베이스 호스팅)만 이용하며, 이는 제3자 마케팅 제공에 해당하지 않습니다.",
        section5Heading: "5. 이용자의 권리",
        section5Body:
          "이용자는 언제든지 본인의 개인정보 열람, 정정, 삭제(계정 탈퇴)를 요청할 수 있습니다. 아래 문의처로 연락해 주시면 확인 후 처리해 드립니다.",
        section6Heading: "6. 쿠키 및 세션",
        section6Body:
          "로그인 상태 유지를 위해 세션 쿠키를 사용합니다. 광고 목적의 추적 쿠키나 제3자 분석 도구는 사용하지 않습니다.",
        section7Heading: "7. 문의",
        section7BodyPrefix: "개인정보 관련 문의는 ",
        section7BodyEmail: "contact@owogg.com",
        section7BodySuffix: "으로 연락해 주세요.",
      },
    },
    gamePlay: {
      errorGameNotFound: "게임을 찾을 수 없습니다.",
      gameDisabledTitle: "현재 이용할 수 없는 게임입니다",
      gameDisabledBody: "운영자가 일시적으로 비활성화했습니다. 잠시 후 다시 확인해주세요.",
      errorLoadFailed: "게임을 불러오는 중 오류가 발생했습니다.",
      errorSubmitFailed: "점수 저장에 실패했습니다.",
      errorNetworkSubmitFailed: "네트워크 오류로 점수를 저장하지 못했습니다.",
      errorSubmitFallback: "기록 저장 실패",
      backToList: "목록으로 돌아가기",
      back: "돌아가기",
      loadingTitle: "게임 로딩중...",
      loadingBody: "게임을 불러오는 중...",
      authRequiredTitle: "로그인이 필요한 게임입니다",
      authRequiredBody: "이 미니게임은 계정 로그인 후 플레이 및 랭킹 등록이 가능합니다.",
      authRequiredCta: "로그인하고 플레이하기",
      resultTitle: "게임 종료!",
      finalScoreLabel: "최종 점수",
      deviceBestLabel: "기기 최고 기록",
      metadataWpm: "속도 (WPM)",
      metadataCpm: "타수 (CPM)",
      metadataAccuracy: "정확도",
      metadataCorrectChars: "정타",
      metadataIncorrectChars: "오타",
      metadataTotalTypedChars: "총 입력 타수",
      metadataDurationMs: "소요 시간 (ms)",
      metadataTargetsHit: "적중 타겟",
      metadataMisses: "실패 타겟",
      metadataLevel: "달성 레벨",
      metadataTargets: "타겟 수",
      metadataAvgPerTargetMs: "타겟당 평균 (ms)",
      metadataSequenceLength: "패턴 길이",
      metadataGrade: "등급",
      metadataAuthoritativeRawScore: "검증 원점수",
      guestNoticeTitle: "게스트 기록은 이 기기에만 저장됩니다.",
      guestNoticeBody: "로그인하면 다음 플레이부터 랭킹에 참여할 수 있습니다.",
      guestLoginCta: "로그인",
      submittingLabel: "랭킹에 점수 등록 중...",
      successLabel: "기록이 랭킹에 등록되었습니다!",
      retrySubmitCta: "점수 다시 제출",
      leaderboardYou: "나",
      retryGameCta: "🔄 다시 하기",
      returnToGameCta: "게임 화면으로 돌아가기",
      backToListResult: "목록으로",
      difficultyNormal: "보통",
      difficultyHard: "어려움",
      shareText: "{title}에서 {score} 기록! 나도 도전해보기 🎮",
      shareXCta: "X에 공유",
      shareDiscordCta: "Discord용 복사",
      shareDiscordCopiedFeedback: "복사 완료! Discord에 붙여넣으세요",
      shareXScreenshotHint: "스크린샷이 복사됐어요! 트윗 작성창에 붙여넣기(Ctrl+V) 하세요",
      screenshotCopyCta: "스크린샷 복사",
      screenshotCopiedFeedback: "이미지가 복사되었습니다!",
      screenshotDownloadedFeedback: "이미지를 다운로드했습니다",
      screenshotErrorFeedback: "스크린샷 생성에 실패했습니다",
      leaderboardTitle: "리더보드",
      leaderboardEmpty: "아직 등록된 기록이 없습니다.",
      viewFullRanking: "전체 순위 보기 →",
      fullscreenEnterCta: "전체 화면",
      fullscreenExitCta: "전체 화면 종료",
      fullscreenRecommendedHint: "권장",
      mobileExperimentalNotice: "모바일 지원은 실험적입니다.",
      mobileUnsupportedNotice: "이 게임은 모바일 환경을 지원하지 않을 수 있습니다.",
      orientationPortraitHint: "이 게임은 세로 화면에 최적화되어 있습니다.",
      orientationLandscapeHint: "이 게임은 가로 화면에 최적화되어 있습니다.",
      bookmarkCta: "북마크",
      bookmarkedCta: "북마크됨",
      shareGameCta: "공유",
      shareGameCopied: "링크 복사됨",
      feedbackCta: "피드백",
      mobilePlayCta: "모바일에서 플레이",
      theaterModeEnterCta: "영화관 모드",
      theaterModeExitCta: "기본 화면",
      adLabel: "광고",
      adPlaceholder: "광고 영역 · 콘텐츠 크기를 안정적으로 유지하는 예약 슬롯입니다.",
      recommendedGamesTitle: "다음 게임 플레이",
      recommendedGamesEmpty: "추천할 다른 공개 게임이 아직 없습니다.",
      gameInfoTitle: "게임 정보",
      publisherLabel: "제작자",
      publishedLabel: "업로드",
      playerStatsLabel: "플레이어",
      bookmarkStatsLabel: "북마크",
      officialGameBadge: "공식 게임",
      userGameBadge: "사용자 제작",
      mobilePlayTitle: "휴대폰에서 이어서 플레이",
      mobilePlayBody: "아래 링크를 복사하거나 공유해 휴대폰 브라우저에서 같은 게임을 여세요.",
      copyGameLinkCta: "게임 링크 복사",
      closeDialogCta: "닫기",
      gameLinkCopied: "게임 링크를 복사했습니다.",
    },
    gameRanking: {
      eyebrow: "게임별 순위",
      backToGame: "게임으로 돌아가기",
      notSupported: "이 게임은 순위를 지원하지 않습니다",
      notSupportedBody: "캐주얼 게임이라 등수 없이 즐기는 게임입니다.",
    },
    userProfile: {
      eyebrow: "플레이어 프로필",
      backToHome: "홈으로",
      notFoundTitle: "사용자를 찾을 수 없습니다",
      notFoundBody: "존재하지 않거나 탈퇴한 계정입니다.",
      loadErrorBody: "프로필을 불러오지 못했습니다.",
      retryButton: "다시 시도",
      joinedPrefix: "가입일",
      levelLabel: "레벨",
      globalRankPrefix: "전체 XP 랭킹 #",
      streakLabel: "연속 출석",
      streakDaysSuffix: "일째",
      longestStreakPrefix: "최고 기록",
      achievementsTitle: "도전과제",
      achievementsEmpty: "아직 달성한 도전과제가 없습니다.",
      achievedSuffix: "달성",
      gameRecordsTitle: "게임별 최고 기록",
      gameRecordsEmpty: "아직 등록된 기록이 없습니다.",
      streamerBadgesTitle: "인증된 스트리머 채널",
      manageProfileCta: "설정 →",
      favoritesTitle: "즐겨찾기",
      favoritesEmpty: "아직 즐겨찾기한 게임이 없습니다.",
      recentPlaysTitle: "최근 플레이",
      recentPlaysEmpty: "아직 플레이 기록이 없습니다.",
      itemsCountSuffix: "개",
      onlyVisibleToYou: "나만 보기",
      settingsCta: "설정에서 변경",
    },
    registeredServers: {
      ariaLabel: "등록된 Discord 서버",
      title: "등록된 서버",
      empty: "아직 등록된 서버가 없습니다.",
      viewAll: "전체 서버 보기 →",
    },
    changelog: {
      eyebrow: "Changelog",
      title: "업데이트 로그",
      subtitle: "OwOGG의 변경 사항과 공지를 확인하세요.",
      emptyState: "아직 등록된 업데이트가 없습니다.",
      tagFeature: "신규",
      tagImprovement: "개선",
      tagFix: "수정",
    },
    platformIcon: {
      chzzkLabel: "CHZZK (치지직)",
      soopLabel: "SOOP (아프리카)",
      channelSuffix: "채널",
      verifiedPlatforms: "검증된 플랫폼",
    },
    contact: {
      eyebrow: "문의하기",
      title: "무엇을 도와드릴까요?",
      subtitle: "문의 유형에 맞는 채널로 보내주시면 더 빠르게 확인할 수 있어요.",
      emailCta: "이메일 주소 복사",
      emailCopiedFeedback: "복사됨!",
      generalLabel: "일반 문의",
      generalDesc: "계정, 사용법, 제안 등 그 외 모든 문의",
      reportLabel: "신고하기",
      reportDesc: "부정행위, 어뷰징, 부적절한 콘텐츠 신고",
      bugLabel: "버그 제보",
      bugDesc: "게임 오류, 기능 오작동 등 버그 제보",
      guidanceTitle: "문의 전 참고해주세요",
      guidanceItems: [
        "버그 제보는 어떤 게임/페이지에서, 어떤 상황에서 발생했는지 함께 적어주세요.",
        "가능하면 스크린샷을 첨부해주시면 큰 도움이 됩니다.",
        "계정 문의는 가입에 사용한 이메일 또는 닉네임을 함께 알려주세요.",
        "신고하기는 신고 대상(닉네임/게시물 등)과 구체적인 상황을 함께 적어주세요.",
      ],
      discordAltTitle: "디스코드로도 문의할 수 있어요",
      discordAltBody: "커뮤니티 서버에서 더 빠르게 소통하고 싶다면 디스코드 가이드를 확인해보세요.",
      discordAltCta: "디스코드 가이드 보기",
    },
  },
  "en-US": {
    common: {
      loading: "Loading...",
      error: "Something went wrong.",
      retry: "Retry",
      empty: "Nothing to show here.",
      save: "Save",
      cancel: "Cancel",
    },
    nav: {
      searchPlaceholder: "Search by game name, tag, or category...",
      favorites: "Favorites",
      login: "Log in",
      logout: "Log out",
      myProfile: "Profile",
      settings: "Settings",
      ranking: "Hall of Fame",
      wiki: "Wiki",
      accountSuffix: " account",
    },
    sidebar: {
      openMenuAria: "Open menu",
      expandMenuAria: "Expand sidebar",
      collapseMenuAria: "Collapse sidebar",
      mobileMenuTitle: "Menu",
      home: "Home",
      allGames: "All Games",
      popularGames: "Popular Games",
      rankingRecords: "Ranking & Records",
      otherHeading: "Other",
      discordHub: "Discord",
      moreHeading: "More",
      favorites: "Favorites",
      discordServers: "Registered Discord Servers",
    },
    footer: {
      tagline: "No install, playable in a second",
      allGames: "All Games",
      ranking: "Hall of Fame",
      wiki: "Wiki",
      changelog: "Changelog",
      contactUs: "Contact Us",
      rightsReserved: "All rights reserved.",
    },
    home: {
      heroEyebrow: "Play instantly, no install",
      heroTitle: "Never a dull moment — all your games in one place",
      heroSubtitle: "Play light web mini-games and compete for the best record with friends.",
      browseGames: "Browse games",
      lineupTitle: "Mini-Game Lineup",
      itemsCountSuffix: "",
      popularTitle: "Popular Games",
      recentPlaysTitle: "Recently Played",
      favoritesTitle: "My Favorites",
      emptyCategory: "No games available in this category yet.",
      gridColumnsAriaPrefix: "View in ",
      gridColumnsAriaSuffix: " columns",
      teaserTitle: "Real-Time Rankings & Multiplayer Coming Soon",
      teaserBody:
        "A multiplayer mode where you and your friends can join with a single link and compete in real time is coming soon.",
      teaserCta: "Preview games",
    },
    language: { label: "Language", ko: "한국어", en: "English", ja: "日本語", zh: "简体中文" },
    loginModal: {
      title: "Sign in to OwOGG",
      subtitle: "Pick a social account to sign in securely.",
      close: "Close",
      googleButton: "Continue with Google",
      googleLoading: "Signing in with Google...",
      googleUnconfigured: "Google sign-in isn't configured yet.",
      discordButton: "Continue with Discord",
      discordLoading: "Signing in with Discord...",
      discordUnconfigured: "Discord sign-in isn't configured yet.",
      providerChecking: "Checking the sign-in server configuration.",
      providerUnavailable: "The sign-in server is temporarily unavailable.",
      retry: "Retry",
    },
    games: {
      eyebrow: "Game Collection",
      title: "All Mini-Games",
      countSuffix: "lightweight mini-games ready to play.",
      searchPlaceholder: "Search games...",
      emptyFavorites: "You haven't favorited any games yet.",
      emptySearch: "No games match your search.",
      sortLabel: "Sort games",
      sortOptions: {
        popular: "Popularity",
        newest: "Release date",
        players: "View count",
        bookmarks: "Bookmark count",
      },
      playerCountLabel: "Players",
      bookmarkCountLabel: "Bookmarks",
      categories: {
        all: "All",
        popular: "Popular",
        reaction: "Reaction",
        brain: "Brain",
        aim: "Aim",
        typing: "Typing",
        favorites: "Favorites",
      },
      addFavoriteAriaPrefix: "Add ",
      addFavoriteAriaSuffix: " to favorites",
      removeFavoriteAriaPrefix: "Remove ",
      removeFavoriteAriaSuffix: " from favorites",
    },
    ranking: {
      eyebrow: "Leaderboard & Community Hall of Fame",
      title: "Hall of Fame",
      subtitle: "Top records, player activity levels, and verified streamer rankings.",
      gameTab: "General Ranking",
      xpTab: "XP Ranking",
      streamerTab: "Streamer Ranking",
      allCategories: "All Games",
      allPlatforms: "All Platforms",
      platformChzzk: "CHZZK",
      platformSoop: "SOOP",
      scoreMode: "Game Score",
      xpMode: "Experience (XP)",
      streakMode: "Attendance Streak",
      dailyPeriod: "Daily",
      weeklyPeriod: "Weekly",
      monthlyPeriod: "Monthly",
      rankHeader: "Rank",
      playerHeader: "Player",
      streamerHeader: "Streamer",
      countryHeader: "Country/Region",
      categoryHeader: "Game",
      recordHeader: "Record",
      dateHeader: "Date",
      modeHeader: "Mode",
      levelHeader: "Level",
      totalXpHeader: "Total XP",
      recordOrCategory: "Record / Game",
      activityLevel: "Activity Level (XP)",
      badgeHeader: "Badge",
      platformHeader: "Platform",
      emptyGames: "No records yet. Be the first to set one.",
      emptyXp: "No users with activity yet.",
      emptyStreak: "No active attendance streaks yet.",
      unknownCountry: "Country/region unset or hidden",
      emptyStreamerTitle: "No verified streamers yet",
      emptyStreamerBody:
        "No verified streamer game, XP, or attendance-streak records match this period and filter yet.",
      retryButton: "Retry",
      rank1: "1st",
      rank2: "2nd",
      rank3: "3rd",
    },
    profile: {
      pageTitle: "Settings",
      pageSubtitle: "Manage your account details and what others can see.",
      visibilityTitle: "Visibility",
      visibilitySubtitle: "Choose what visitors see when they open your profile.",
      visibilityFavoritesLabel: "Favorites",
      visibilityRecentPlaysLabel: "Recent Plays",
      visibilityPublicOption: "Public",
      visibilityPrivateOption: "Private",
      visibilityUpdated: "Visibility saved.",
      visibilityUpdateFailed: "Couldn't save visibility.",
      joinedLabel: "Joined",
      viewProfileCta: "View profile",
      logout: "Log out",
      favoritesTitle: "Favorites",
      emptyFavorites: "No favorite games yet. Tap the bookmark icon on a game card to add one.",
      recentPlaysTitle: "Recently Played",
      achievementsTitle: "Achievements",
      emptyAchievements: "No achievements yet. Play games and add favorites to unlock some!",
      noRecordLabel: "No record on this account",
      deviceRecordLabel: "Device record",
      noRecordYetHint: "No record yet — give it a try now!",
      justNow: "just now",
      minutesAgoSuffix: "m ago",
      hoursAgoSuffix: "h ago",
      daysAgoSuffix: "d ago",
      linkSuccess: "Your login method has been linked.",
      alreadyLinkedAccount: "This account is already linked.",
      linkError: "An error occurred while linking your login method.",
      streamerVerifySuccess: "Streamer channel ownership verification is complete.",
      streamerVerifyConflict:
        "This channel is already linked to a different OwOGG streamer account.",
      streamerVerifyUnconfigured: "Verification for this platform isn't available right now.",
      streamerVerifyUnauthorized: "Your login has expired. Please log in again.",
      streamerVerifyError: "An error occurred while verifying your streamer channel.",
      googleScriptNotReady: "The Google login script isn't ready yet.",
      googleLinkSuccess: "Your Google login has been linked.",
      googleAccountInUse: "This Google account is already in use by a different OwOGG account.",
      googleAlreadyLinked: "This account already has Google login linked.",
      googleLinkFailed: "Failed to link your Google account.",
      unlinkSuccessSuffix: "has been unlinked.",
      lastAuthProviderError: "You can't unlink your last remaining login method.",
      unlinkFailed: "Failed to unlink.",
      mergeCompleted: "Account merge is complete.",
      nicknameUpdated: "Your nickname has been changed.",
      nicknameCooldownPrefix: "You can change your nickname again after",
      nicknameCooldownSuffix: ".",
      nicknameUpdateFailed: "Failed to change your nickname.",
      nicknamePolicyHint:
        "Nicknames may be duplicated and appear publicly as ‘Nickname #UserNumber’. After a change, you must wait 30 days to change it again.",
      nicknamePreviewLabel: "Public display",
      avatarTitle: "Profile picture",
      avatarSubtitle: "Choose an image from your connected Google or Discord account.",
      avatarUseButton: "Use this image",
      avatarSelected: "Currently selected",
      avatarUpdated: "Your profile picture has been changed.",
      avatarUpdateFailed: "Failed to change your profile picture.",
      avatarUnavailable: "No profile picture is available.",
      countryUpdated: "Your country/region has been changed.",
      countryCooldownPrefix: "You can change your country/region again after",
      countryCooldownSuffix: ".",
      countryUpdateFailed: "Failed to change your country/region.",
      loginRequiredTitle: "You need to log in to view this page",
      loginRequiredBody: "Log in with Google or Discord to manage your game records.",
      loginRequiredCta: "Log in",
      backButton: "Go back",
      levelLabel: "Level",
      globalXpRankPrefix: "Global XP rank #",
      totalXpPrefix: "Total ",
      settingsTitle: "Profile Settings",
      nicknameLabel: "Nickname",
      nicknamePlaceholder: "Enter a nickname",
      changeButton: "Change",
      countryLabel: "Country/Region",
      countryHint: "(optional, self-reported — not identity verification)",
      countryNotSet: "Not set",
      itemsCountSuffix: "",
      emptyRecentPlays: "No plays recorded yet. They'll show up here once you play a game.",
      connectedAccountsTitle: "Connected Login Accounts",
      linkedStatus: "Linked",
      notLinkedStatus: "Not linked",
      unlinkButton: "Unlink",
      linkButton: "Link",
      streamerVerificationTitle: "Streamer Channel Ownership Verification",
      streamerVerificationSubtitle:
        "Verified directly via official OAuth/API that you own the channel. (No self-reported text entry or web scraping.)",
      ownershipVerified: "Ownership verified",
      unverified: "Unverified",
      verifiedConfirmedText:
        "✓ OwOGG confirmed this user's channel ownership via the official API.",
      audienceCountLabel: "Subscribers/Followers",
      audienceUnit: "",
      metricsSyncedPrefix: "· Metrics synced",
      verifyChannelCta: "Verify channel ownership",
      verifyUnavailable: "Verification isn't available right now",
      featuredReviewStatusTitle: "Featured Review Status",
      featuredStreamerLabel: "★ Featured Streamer",
      featuredSelectedSuffix: "selected",
      featuredHint:
        "Featured status is based on official channel metrics (12,000+ subscribers/followers · channel 120+ days old) and has no effect on game scores, XP, or ranking.",
      achievedSuffix: "unlocked",
      myGameRecordsTitle: "My Best Records by Game",
      challengeSuffix: "attempted",
      viewFullRankingArrow: "View full ranking →",
      reviewNotStarted:
        "Automatic review begins once channel ownership verification is complete. (First review in about 6 hours)",
      autoReviewPending: "Automatic review pending",
      nextReviewPrefix: "(next review",
      notEligible: "Not currently eligible",
      manualReviewNeeded: "Manual review needed",
      autoReviewFailed: "Automatic review temporarily failed (waiting to retry)",
      nextRetryPrefix: "— next retry",
    },
    discord: {
      heroTitle1: "Compete and connect with",
      heroTitle2: "friends through your game records",
      heroSubtitle:
        "Add the OwOGG Discord Bot to your server to build a community-only leaderboard and a dedicated server page.",
      installCta: "Add OwOGG to Discord",
      setupCta: "🧭 Setup Guide (5 steps)",
      searchCta: "🔍 Search Servers",
      registerCta: "⚡ Register My Server (admin required)",
      guideCta: "📖 Discord Usage Guide",
      managedServersTitle: "🛡️ Servers I Manage",
      exploreAll: "Explore all →",
      loadingServers: "Loading server list...",
      noManagedServers: "You don't manage any registered servers",
      loginRequired: "Login required",
      registerPrompt:
        "Register a server where you have Discord admin permissions to start your community.",
      registerStart: "Start server registration",
      publicPage: "Public page",
      manageServer: "Manage server",
      registeredLabel: "Registered",
      weeklyRankingTitle: "This Week's Server Activity Ranking",
      loadingRanking: "Loading ranking...",
      emptyWeeklyRanking: "No server activity registered this week",
      guideTitle: "📌 Usage Guide",
      guideStep1: "Only users with Discord admin (MANAGE_GUILD) permission can register a server.",
      guideStep2: "Public registration exposes your server in the OwOGG directory and search.",
      guideStep3:
        "Playing games via /owogg play contributes XP to this server and counts toward the weekly ranking.",
      accountLinkTitle: "🔗 Link Discord Account",
      accountLinkBody:
        "Linking your OwOGG account with your Discord account lets you check your info via bot commands (/owogg profile).",
      accountLinkCta: "Go to account linking page",
      usageGuideCta: "View Discord usage guide",
    },
    discordSetup: {
      eyebrow: "OwOGG × Discord",
      title: "Discord Setup Guide",
      subtitle:
        "Just follow these 5 steps to start using OwOGG right in your server. You won't need a Bot Token or Application ID — only the OwOGG team handles those.",
      step1Title: "Add OwOGG to Discord",
      step1Description:
        "Install the Discord app to your server using an account with server admin permission.",
      checkingInstallLink: "Checking install link...",
      installLinkUnavailable:
        "The install link isn't ready yet. Ask your server admin for the official install link.",
      installNote:
        "Installing the Discord app is different from registering your server on OwOGG (step 3) — installation alone doesn't auto-register your server.",
      installStatusHint:
        "This badge can't be checked automatically, so it always looks like this — that's normal even if you've already installed it. If OwOGG shows up in your server's member list, installation is complete.",
      step2Title: "Link Your Discord Account",
      step2Description: "Link your account so bot commands can look up your own OwOGG info.",
      checking: "Checking...",
      owoggLoginCta: "Log in to OwOGG",
      linkedNote1: "Linked. You can use",
      linkedNote2: "on Discord.",
      linkAccountCta: "Go to account linking page",
      step3Title: "Register a Server",
      step3Description:
        "Register a server where you have Discord admin (MANAGE_GUILD) permission as a OwOGG community.",
      loginFirst: "Please log in to OwOGG first.",
      alreadyRegisteredPrefix: "You already manage/register ",
      alreadyRegisteredSuffix: " server(s).",
      registerStartCta: "Start server registration",
      viewServerDirectory: "View server directory",
      step4Title: "Test /owogg games",
      step4Description:
        "Check that the slash command autocompletes correctly in your Discord channel.",
      notShowingUp: "If it doesn't show up in autocomplete, check the",
      troubleshootingGuide: "troubleshooting guide",
      checkSuffix: ".",
      step5Title: "Start with /owogg play",
      step5Description: "Get a play link tied to this server and start earning server XP.",
      viewFullGuide: "View full usage guide",
      footerNote1:
        "Regular users never need to enter a Bot Token, Application ID, or Public Key. For more details, see the",
      discordWikiLink: "Discord Wiki",
      footerNote2: ".",
      badgeDone: "Done",
      badgeTodo: "Action needed",
      badgeUnknown: "Check yourself",
    },
    discordGuide: {
      eyebrow: "OwOGG × Discord",
      heroTitle: "Using OwOGG on Discord",
      heroSubtitle:
        "Start games from your server and check your activity via server XP and the leaderboard. OwOGG runs on signed HTTP Interactions, not an always-on Gateway bot.",
      installCta: "Add to Discord",
      installLinkHint: "Check with your server admin for the install link",
      serverDirectoryCta: "Server directory",
      heroSetupCta: "5-step setup guide",
      onboardingEyebrow: "ONBOARDING",
      onboardingTitle: "Haven't finished installing, linking, or registering yet?",
      onboardingBody:
        "Track install, account linking, and server registration in one live 5-step checklist, and pick up right where you left off.",
      onboardingCta: "Open the 5-step setup guide",
      xpTitle: "How server XP is calculated",
      xpSubtitle: "Global XP and server XP are not the same number copied around.",
      xpGlobalTitle: "Global XP",
      xpGlobalText: "Your overall OwOGG progress",
      xpGuildATitle: "Guild A user XP",
      xpGuildAText: "Valid contributions made in A",
      xpGuildBTitle: "Guild B",
      xpGuildBText: "Existing XP isn't auto-copied",
      antiAbuseLabel: "Anti-abuse:",
      antiAbuseText:
        "Global XP is capped at 10 grants per user × game × UTC day. Once the cap is reached you can still complete games, but no additional XP is granted.",
      commandsTitle: "Commands",
      commandGamesDesc: "See the list of games you can play.",
      commandLinkDesc: "Link your Discord account with your OwOGG account.",
      commandProfileDesc: "Check your linked account's profile, level, and global XP.",
      commandPlayDesc: "Create a one-time game play link tied to the server.",
      commandRankDesc: "Check your XP and rank in the current server.",
      commandLeaderboardDesc: "See the current server's XP Top 10.",
      commandServerDesc: "Check the server's total XP and weekly activity.",
      rankingGuideTitle: "Viewing server rankings",
      rankingGuideP1:
        "The server page shows server XP, weekly server XP, and per-game server participant records.",
      rankingGuideP2:
        "Only active `PUBLIC` servers appear in the public global server activity ranking. Participant counts are based on users who created OwOGG activity, not total Discord member counts.",
      viewFullRankingCta: "View the full OwOGG ranking",
      helpGuideTitle: "Troubleshooting",
      helpP1:
        "If you see a message that the server isn't registered, check whether an admin has completed server registration.",
      helpP2:
        "For account linking errors, run `/owogg link` again and re-verify with an unexpired link.",
      helpP3: "If your play link has expired or been used already, you'll need to issue a new one.",
      faqTitle: "Frequently Asked Questions",
      faq1Q: "Does installing the app automatically make my server public?",
      faq1A:
        "No. Installing the app and registering on OwOGG are separate steps. An admin must confirm the guild on the web and choose visibility themselves.",
      faq2Q: "Does OwOGG pull in all members of my Discord server?",
      faq2A:
        "No. It checks manageable guilds via official OAuth, and only participants who created OwOGG activity are used for XP rankings.",
      faq3Q: "Can I import my existing global XP into a server all at once?",
      faq3A:
        "No. A new guild starts at 0, and only valid completions made via `/owogg play` are attributed to it.",
      faq4Q: "Do I need to run an always-on bot process?",
      faq4A:
        "Not in v1. The Discord HTTP Interactions endpoint and a Cloudflare Worker handle requests.",
      footerNote: "For more detailed operating procedures, see the Discord Bot operations guide.",
      footerHubCta: "Go to Discord Hub",
    },
    discordServers: {
      pageTitle: "🔍 Discord Server Directory",
      pageSubtitle: "Browse Discord communities registered on OwOGG, or register your own server.",
      registerCta: "🏰 Register my server",
      searchPlaceholder: "Search by server name or vanity slug...",
      searchButton: "Search",
      statusNoGuilds:
        "Couldn't find any Discord server where you have admin (MANAGE_GUILD) permission.",
      statusUnauthorized: "You need to log in to register a server.",
      statusError: "An error occurred during Discord authentication. Please try again.",
      candidateLoadError:
        "Couldn't load the list of servers you can register. The token may be expired or already used.",
      guildListFetchError: "Failed to fetch server list",
      registerFailError: "Failed to register server",
      modalTitle: "🏰 Register Discord Server",
      successTitle: "Server registered successfully!",
      viewPublicPage: "View public page",
      manageServer: "Manage server",
      step1Label: "1. Choose a server to register (guilds you manage)",
      step2Label: "2. Set a vanity slug (optional)",
      slugPlaceholder: "Auto-generated (lowercase letters, numbers, -)",
      step3Label: "3. Choose visibility",
      cancelButton: "Cancel",
      submittingButton: "Registering...",
      submitButton: "Complete server registration",
      totalCountPrefix: "A total of ",
      totalCountSuffix: " public servers are registered.",
      searchTermLabel: "Search term:",
      loadingList: "Loading server list...",
      emptyResultsTitle: "No public servers match your search.",
      emptyResultsHint: "Try a different search term, or register a new server.",
      owoggServerLabel: "OwOGG server",
      viewPageArrow: "View page →",
    },
    discordServerSlug: {
      loadFailedGeneric: "Couldn't load server info.",
      loadingServer: "Loading server info...",
      privateServerTitle: "Private server",
      notFoundTitle: "Server not found",
      privateServerMessage:
        "This server is set to PRIVATE visibility — only authorized admins can access it.",
      backToDirectory: "← Back to directory",
      manageServerCta: "⚙️ Manage server",
      participantsLabel: "OwOGG participants",
      participantsUnit: "",
      participantsHint: "Users who have contributed activity",
      totalXpLabel: "Total server XP",
      totalXpHint: "Sum of all game activity",
      weeklyXpLabel: "This week's server XP",
      weeklyXpHint: "As of Monday 00:00 KST",
      leaderboardTitle: "Server leaderboard",
      tabAlltime: "⚡ Server XP",
      tabWeekly: "📅 Weekly XP",
      tabGames: "🎮 Per-game records",
      emptyAlltimeTitle: "No XP has accumulated on this server yet",
      emptyAlltimeHintPrefix: "Run",
      emptyAlltimeHintSuffix: "in a Discord channel to contribute to a game!",
      emptyWeeklyTitle: "No XP has accumulated on this server this week",
      emptyWeeklyHint: "Start your first play after Monday 00:00 KST to claim the weekly rank!",
      loadingGame: "Loading game...",
      emptyGameScoreSuffix: "has no recorded server member scores",
      emptyGameHintPrefix: "Try the",
      emptyGameHintSuffix: "command in a Discord channel!",
      infoCardTitle: "OwOGG server info",
      statusLabel: "Status",
      visibilityLabel: "Visibility",
    },
    discordServerManage: {
      noPermissionError:
        "You don't have permission to manage this server. Check that you're logged in with a Discord admin account.",
      saveFailedError: "Failed to save settings",
      unregisterFailedError: "Failed to unregister server",
      loadingManageInfo: "Loading server management info...",
      accessDeniedTitle: "Access denied",
      backToDirectory: "← Go to directory",
      manageTitleSuffix: "server management",
      manageSubtitle: "Set public/private visibility, a custom vanity slug, and a description.",
      publicPageArrow: "Public page →",
      saveSuccessMessage: "Settings saved successfully.",
      slugLabel: "Vanity slug (lowercase letters, numbers, -)",
      slugHintPrefix: "Changing this does not change the Discord Guild ID (",
      slugHintSuffix: ") itself.",
      visibilityLabel: "Server visibility",
      visibilityPublicDesc: "Shown in search and accessible via the public page",
      visibilityUnlistedDesc: "Hidden from search, accessible via direct link",
      visibilityPrivateDesc: "Hidden from search, admin access only",
      descriptionLabel: "Server description",
      descriptionPlaceholder: "Enter a description of your server or community...",
      savingButton: "Saving...",
      saveButton: "Save settings",
      dangerZoneTitle: "Danger Zone",
      dangerZoneText:
        "Unregistering removes the server from the OwOGG directory and sets it to `DISABLED`. (The Discord server itself is unaffected.)",
      unregisterButton: "Unregister server",
      unregisterConfirmTitle: "Unregister this server?",
      unregisterConfirmBodySuffix: "will be removed from the OwOGG directory and search.",
      cancelButton: "Cancel",
      unregisteringButton: "Unregistering...",
      confirmUnregisterButton: "Confirm (unregister)",
    },
    discordLink: {
      checkingLinkInfo: "Checking link info...",
      invalidTitle: "Invalid link",
      invalidBodyPrefix: "This link has expired or was already used. Run",
      invalidBodySuffix: "again on your Discord server.",
      linkingInProgress: "Linking your Discord account...",
      errorTitle: "Linking failed",
      genericErrorMessage: "An error occurred while linking.",
      alreadyLinkedTitle: "Already linked",
      linkedTitle: "Your Discord account has been linked",
      successBodyPrefix: "You can now check your OwOGG account info on Discord with the",
      successBodySuffix: "command.",
      goToProfileCta: "Go to my profile",
      linkAccountTitle: "Link Discord Account",
      confirmPromptPrefix: "Link the Discord account",
      confirmPromptSuffix: "with your currently logged-in OwOGG account?",
      loginRequiredHint: "Please log in to OwOGG first to link your account.",
      loginCta: "Log in",
      linkCta: "Link account",
    },
    wiki: {
      navGettingStarted: "Getting Started",
      navDiscordOverview: "Discord Overview",
      navDiscordInstall: "Installation",
      navDiscordAccountLink: "Account Linking",
      navDiscordServerRegistration: "Server Registration",
      navDiscordCommands: "Commands",
      navDiscordXp: "Server XP",
      navDiscordTroubleshooting: "Troubleshooting",
      navAccount: "Account",
      navAccountOverview: "Account Overview",
      navAccountMerge: "Account Merge",
      navGamesRanking: "Games & Ranking",
      navGamesOverview: "Games Overview",
      navRanking: "Ranking",
      navGamesXp: "XP & Levels",
      navGamesDevelopment: "게임 개발 및 등록",
      navStreamerOverview: "Streamer Overview",
      navStreamerVerification: "Channel Ownership Verification",
      navStreamerFeatured: "Featured Streamer",
      navSupport: "Support",
      catSupportDesc: "Contact, report, and bug report channels",
      tocAriaLabel: "Wiki table of contents",
      homeTitle: "Find what you need, fast",
      homeSubtitle:
        "From Discord install to how rankings are calculated — everything you need to use OwOGG, all in one place.",
      homeInstallPrompt: "Need a quicker Discord install? Jump straight to",
      homeInstallGuideLink: "the 5-step install guide",
      homeInstallGuideSuffix: ".",
      catDiscordDesc:
        "Server install, account linking, server registration, commands, server XP, troubleshooting.",
      catGettingStartedDesc: "The fastest path from creating a OwOGG account to your first game.",
      catAccountDesc: "Login methods, profile settings, and merging multiple accounts into one.",
      catGamesDesc: "The game catalog, how rankings are calculated, and XP & levels.",
      catStreamerDesc:
        "Channel ownership verification, streamer ranking eligibility, and Featured Streamer criteria.",
      catPolicyTitle: "Policies",
      catPolicyDesc: "Check the Terms of Service and Privacy Policy.",
    },
    wikiBody: {
      streamer: {
        title: "Streamer Overview",
        description:
          "Streamers and YouTubers whose channel ownership is verified through official OAuth/APIs are recognized as OwOGG Streamers.",
        intro:
          "Streamer verification gives no bonus whatsoever to game scores or XP. Instead it unlocks visibility in the Hall of Fame's streamer ranking tab, plus a verified badge and official channel links on your profile.",
        cardVerification: "Channel Ownership Verification →",
        cardVerificationDesc: "Supported platforms and how to verify",
        cardFeatured: "Featured Streamer →",
        cardFeaturedDesc: "Featured eligibility criteria",
        profileHint: "You can start verification from your profile page.",
        profileLink: "Go to my profile",
      },
      streamerVerification: {
        title: "Channel Ownership Verification",
        description:
          "Ownership is verified using official OAuth and APIs only. Text entry and scraping are never used.",
        platformsHeading: "Supported platforms",
        conditionsHeading: "Requirements",
        condOnePrefix: "Verifying ",
        condOneStrong: "just one",
        condOneSuffix:
          " of the four platforms above (YouTube · CHZZK · SOOP · Twitch) is enough to be recognized as an OwOGG Streamer — you do not need to verify all four.",
        condNoMinimum:
          "There is currently no minimum subscriber/follower count or channel age requirement. Ownership simply needs to be confirmed via official OAuth.",
        condOauthOnly:
          "Verification always happens through each platform's official OAuth login screen. Entering a channel URL or nickname by hand is not supported.",
        condOneChannelOneAccount:
          "An external channel can be linked to only one OwOGG account (1 channel = 1 account).",
        methodHeading: "How to verify",
        step1: "Go to the [Streamer Channel Ownership Verification] section on your profile page.",
        step2: "Click the [Verify Channel Ownership] button for the platform you want to verify.",
        step3:
          "Sign in and approve with your own account on that platform's official login screen.",
        step4:
          "When you return to OwOGG, your channel details are confirmed and shown automatically.",
        calloutLoginStrong: "Signing in to OwOGG and verifying a channel are separate things.",
        calloutLoginBody:
          " Signing in with Google does not automatically link your YouTube channel — you must go through the explicit verification flow.",
        calloutDuplicate:
          "An external channel can be linked to only one OwOGG account. A channel already verified by another user cannot be verified again.",
        footerPrefix: "To appear in the streamer ranking, verifying ",
        footerStrong: "just one",
        footerMid: " of the four platforms above is enough. For full eligibility details, see the ",
        footerLink: "ranking article",
        footerSuffix: ".",
      },
      streamerFeatured: {
        title: "Featured Streamer",
        description:
          "Featured is a display/filtering-only badge, reviewed against public channel metrics by OwOGG's criteria.",
        conceptHeading: "Terminology",
        conceptStreamerTerm: "Streamer",
        conceptStreamerDesc: " — channel ownership verified through official OAuth/APIs.",
        conceptFeaturedTerm: "Featured Streamer",
        conceptFeaturedDesc:
          " — a Streamer that also passed automatic/manual review against OwOGG's criteria (public metrics such as subscribers/followers and channel age).",
        reviewHeading: "How review works",
        reviewBody:
          "Featured is not granted immediately after ownership verification. After some time an automatic re-review runs against fresh official metrics; if the metrics are ambiguous, or the platform does not expose them via an official API, the job is safely routed to manual staff review. Featured accounts are also periodically re-validated afterwards.",
        calloutNoRankImpactStrong: "Featured never affects scores, XP, or ranking position.",
        calloutNoRankImpactBody:
          " It is a display-only badge — the streamer ranking is driven purely by channel ownership verification, regardless of Featured status.",
        calloutTestingPhase:
          "We are currently in a service validation phase, so Featured is not granted automatically: every Streamer with verified channel ownership goes through a staff manual-review queue. Streamer ranking visibility is identical regardless of Featured status, and the Featured badge is not publicly displayed yet.",
        footerNote:
          "Staff review criteria and procedures are maintained separately as internal operations documents, and specific figures are not published — review always uses only metrics verifiable through official APIs.",
      },
      account: {
        title: "Account Overview",
        description:
          "OwOGG supports Google and Discord sign-in, and by default the two are separate accounts.",
        loginHeading: "Sign-in methods",
        loginBody:
          "You can sign in with Google or Discord. Even for the same person, an account created via Google and one created via Discord are different OwOGG accounts by default — they are never merged automatically.",
        profileHeading: "Profile settings",
        profileBody:
          "On your profile page you can set your nickname and country/region, and review your level, XP, achievements, favorites, and recent play history.",
        profileLink: "Go to my profile →",
        calloutPrefix:
          "If you created separate Google and Discord accounts, you can combine them into one with ",
        calloutLink: "account merge",
        calloutSuffix: ".",
      },
      accountMerge: {
        title: "Account Merge",
        description:
          "Primary Account Wins — pick the account you want to keep (the Primary) first, then proceed.",
        howHeading: "How it works: Primary Account Wins",
        howBodyPrefix: "Designate the account you want to keep using as the ",
        howBodyPrimary: "Primary",
        howBodySuffix:
          ". Once the merge completes, the Primary's game records, XP, and personalization settings are kept as-is, while the Secondary's equivalent data is discarded rather than combined. Only the Google/Discord sign-in methods attached to the Secondary move over to the Primary, so afterwards either method signs you into the same Primary account.",
        stepsHeading: "Steps",
        step1: "Sign in with the account you want to keep (the Primary).",
        step2:
          "Start the account merge and verify ownership of the account to be merged (the Secondary).",
        step3: "Review the summary — the Secondary's game/personalization data will not be kept.",
        step4: "Confirm to finalize the merge.",
        step5:
          "From then on, the former Secondary sign-in method also signs you into the Primary account.",
        calloutNoMergeStrong: "Records are not combined.",
        calloutNoMergeBody:
          " Only the Primary's scores/XP/progress are kept; the Secondary's records are gone after the merge — be sure to choose the account you want to keep as the Primary.",
        calloutAdminStrong: "The merge is blocked if the Secondary is an administrator account.",
        calloutAdminBody:
          " Merging an account that holds admin privileges as the Secondary could make those privileges vanish without transferring anywhere, so for safety OwOGG blocks the merge outright and requires separate handling by staff.",
        footerPrefix:
          "For the rules that apply when merging an account with Streamer channel ownership verification, see the ",
        footerLink: "Streamer channel ownership verification",
        footerSuffix: " article.",
      },
      games: {
        title: "Games & Ranking Overview",
        description:
          "OwOGG offers a catalog of mini-games including reaction time, sequence memory, aim, and typing speed.",
        intro:
          "Each game has its own rules and scoring, and valid records are reflected in the rankings automatically. Separately from scores, the act of playing also accumulates XP.",
        cardRanking: "Ranking →",
        cardRankingDesc: "How per-game and streamer rankings are calculated",
        cardXp: "XP & Levels →",
        cardXpDesc: "How XP is granted and the level formula",
        cardDevelopment: "게임 개발 및 등록 →",
        cardDevelopmentDesc: "게임 크리에이터가 되어 직접 게임을 올리는 방법",
        footerPrefix: "Jump right into the ",
        footerLink: "game catalog",
        footerSuffix: " and start playing.",
      },
      gamesDevelopment: {
        title: "게임 개발 및 등록",
        description: "누구나 만든 웹 게임을 게임 크리에이터로 OwOGG에 올릴 수 있습니다.",
        intro:
          "웹으로 빌드되는 것이면 장르 제약 없이 올릴 수 있습니다 — 슈터, 퍼즐, 캐주얼, 액션, 무엇이든 좋습니다. 유일한 조건은 결과물이 index.html을 진입점으로 갖는 정적 웹 파일 묶음이어야 한다는 것입니다.",
        eligibilityHeading: "게임 크리에이터 자격 얻기",
        eligibilityBody:
          "게임을 업로드하려면 먼저 게임 크리에이터 자격이 필요합니다. 운영팀이 직접 임명하는 방식으로 운영되고 있으며, 셀프서비스 신청 기능은 현재 준비 중입니다(추후 업데이트 예정). 자격이 필요하면 운영팀에 문의해주세요.",
        eligibilityLink: "게임 크리에이터 센터 확인하기",
        sdkHeading: "호스트 연동 — 2줄이면 충분",
        sdkBody:
          "게임이 OwOGG 호스트에게 알려야 할 건 '로딩 끝남'과 '게임 종료 + 점수' 두 가지뿐입니다.",
        limitsHeading: "용량 제한",
        limitBundle: "ZIP 1개당 최대 20MiB (업로드 시점 압축 크기 기준)",
        limitExtracted: "압축을 풀었을 때 총 50MiB 이하",
        limitFiles: "파일 개수 300개 이하",
        flowHeading: "제출 → 심사 → 공개",
        flowStep1:
          "업로드: 게임 크리에이터 센터에서 owogg.json이 포함된 ZIP을 끌어다 놓으면 게임 등록과 업로드가 한 번에 끝납니다. 업로드 직후는 본인에게만 보입니다.",
        flowStep2:
          "심사: 운영팀이 실제로 플레이해보고 콘텐츠를 확인합니다. 승인되어도 자동으로 공개되지 않습니다.",
        flowStep3:
          "공개: 운영팀이 별도로 공개 전환해야 그 순간부터 실제 유저에게 서비스가 시작됩니다.",
        policyHeading: "콘텐츠 정책",
        policyBody:
          "불법 콘텐츠, 혐오/차별 표현, 성인 콘텐츠, 타인의 IP를 침해하는 에셋/텍스트, 악성 코드나 다른 유저에게 피해를 주는 로직은 금지됩니다.",
        footerPrefix: "자세한 업로드 절차는 ",
        footerLink: "게임 크리에이터 센터",
        footerSuffix: "에서 직접 확인하세요.",
      },
      gamesRanking: {
        title: "Ranking",
        description:
          "The Hall of Fame (/ranking) gives General and Streamer rankings the same layout. Each scope offers game records, XP, and attendance streaks.",
        gameHeading: "General ranking",
        gameBody:
          "Game records and XP are split into daily, weekly, and monthly KST periods. Game records count one personal best per user within the selected period; streaks show the currently valid number of days.",
        xpHeading: "Periods and achieved dates",
        xpBodyPrefix:
          "Every row shows the full date when its ranking value was reached. For how XP is granted, see the ",
        xpBodyLink: "XP & levels article",
        xpBodySuffix: ".",
        streamerHeading: "Streamer ranking",
        streamerBodyPrefix: "Only users who completed official channel ownership verification on ",
        streamerBodyStrong: "at least one",
        streamerBodySuffix:
          " of YouTube / CHZZK / SOOP / Twitch appear here. Game, XP, and streak rankings use the same formula and UI as General rankings, and the number of verified platforms has no effect on position.",
        streamerLinkPrefix: "For how to verify, see the ",
        streamerLink: "Streamer channel ownership verification",
        streamerLinkSuffix: " article.",
        calloutFeatured:
          "The Featured Streamer mark is a display-only badge that has no effect whatsoever on ranking position or XP calculation.",
        footerPrefix: "For per-Discord-server rankings, see the ",
        footerLink: "Discord server XP article",
        footerSuffix: ".",
      },
      gamesXp: {
        title: "XP & Levels",
        description:
          "Every valid game completion accumulates XP, and your level rises with cumulative XP.",
        grantHeading: "How XP is granted",
        grantPerPlay: "10 XP is granted per accepted game completion.",
        grantDailyCap: "XP is granted for at most 10 completions of the same game per day (UTC).",
        grantAfterCap:
          "You can keep playing after hitting the cap — only the additional XP stops being granted.",
        formulaHeading: "Level formula",
        formulaPrefix: "The cumulative XP required to reach level L is ",
        formulaSuffix: ". The higher your level, the more XP the next level takes.",
        calloutPrefix: "Curious how XP earned in a Discord server relates to global XP? See the ",
        calloutLink: "Discord server XP article",
        calloutSuffix: ".",
        footerPrefix: "You can check your level and XP on ",
        footerProfileLink: "your profile",
        footerMid: ", and the overall standings in the ",
        footerRankingLink: "Hall of Fame",
        footerSuffix: ".",
      },
      gettingStarted: {
        title: "Getting Started",
        description:
          "The fastest path to playing your first game and putting a record on the board.",
        flowHeading: "Basic flow",
        step1: "Sign in with an OwOGG account (Google or Discord).",
        step2: "Pick a mini-game from the game catalog.",
        step3: "Play and check your result — valid records are saved automatically.",
        step4: "Check your position and XP in the Hall of Fame (ranking).",
        step5: "Optionally connect Discord to compete with friends in your server.",
        calloutGuest:
          "You can play as a guest. However, signing in is required for records to be saved to an account and counted toward rankings/XP.",
        cardCatalog: "Game catalog →",
        cardCatalogDesc: "Pick something to play right now",
        cardRanking: "Hall of Fame →",
        cardRankingDesc: "Check game/XP/streamer rankings",
        footerPrefix: "To play with friends in a Discord server, see the ",
        footerDiscordLink: "Discord article",
        footerMid: "; for account settings, see the ",
        footerAccountLink: "account article",
        footerSuffix: ".",
      },
      discordOverview: {
        title: "Discord Overview",
        description:
          "OwOGG isn't an always-online bot — it runs on signed HTTP Interactions. Install, account link, and server registration are three separate steps.",
        calloutStrong:
          "Regular users never need to handle a Bot Token, Application ID, or Public Key.",
        calloutBody: " Only the OwOGG team manages those values, as GitHub Actions secrets.",
        flowHeading: "Full flow",
        step1: "Add the OwOGG app to Discord (requires server manager permission).",
        step2: "Confirm and authorize the server you selected.",
        step3: "Come back to OwOGG and link your Discord account.",
        step4: "Register a server you manage as an OwOGG community.",
        step5: "In Discord, start with /owogg games or /owogg play.",
        cardInstall: "Install →",
        cardInstallDesc: "How to add the app to your server",
        cardServerReg: "Server registration →",
        cardServerRegDesc: "Choose PUBLIC/UNLISTED/PRIVATE",
        cardCommands: "Commands →",
        cardCommandsDesc: "Every /owogg subcommand",
        cardTroubleshooting: "Troubleshooting →",
        cardTroubleshootingDesc: "Fixes for common symptoms",
        footerPrefix: "Ready to install right now? Use the ",
        footerLink: "5-step install guide",
        footerSuffix: ".",
      },
      discordInstall: {
        title: "Installing OwOGG on Discord",
        description:
          "Installing the Discord app is the setup step before you can use OwOGG in a server. It's separate from server registration.",
        calloutStrong: "Regular users never need to enter a Bot Token.",
        calloutBody:
          " Just click the official install link below and follow Discord's server-select/authorize screen.",
        checklistPrefix:
          "To track install, account linking, and server registration in real time, use the ",
        checklistLink: "5-step setup guide",
        checklistSuffix: ".",
        buttonLabel: "Add OwOGG to Discord",
        loadingPrefix: "The install link is still loading, or isn't ready yet.",
        loadingLink: "Install guide",
        loadingSuffix: " to check again.",
        calloutWarningStrong: "Installing the app ≠ registering your server with OwOGG.",
        calloutWarningBodyPrefix:
          " Installing the app doesn't automatically publish your server to the OwOGG directory. An admin must separately complete ",
        calloutWarningLink: "server registration",
        calloutWarningSuffix: ".",
        footerPrefix: "The next step after installing is ",
        footerLink: "account linking",
        footerSuffix: ".",
      },
      discordAccountLink: {
        title: "Account Linking",
        description:
          "Linking your Discord account to your OwOGG account lets bot commands (/owogg profile, /owogg play, etc.) use your OwOGG info.",
        methodHeading: "How to link",
        step1: "Run the /owogg link command in a Discord server.",
        step2: "The bot replies with a one-time link visible only to you (ephemeral).",
        step3: "Click that link to go to the OwOGG website.",
        step4: "Sign in to OwOGG first if you aren't already.",
        step5: "Approve on the confirmation screen and you're done.",
        calloutPrefix:
          "The link is single-use and expires after a while. If it expired or was already used, run ",
        calloutCode: "/owogg link",
        calloutSuffix: " again in Discord to get a new one.",
        calloutWarning:
          "Each Discord account stays bound to the first OwOGG account that registered it. Unlinking does not release that ownership or allow it to move to another account.",
        footerPrefix: "Having trouble linking? Check the ",
        footerLink1: "troubleshooting guide",
        footerMid: ", or open the ",
        footerLink2: "account linking page",
        footerSuffix: " directly on the website.",
      },
      discordServerRegistration: {
        title: "Server Registration",
        description:
          "Installing the app and registering a server are separate. Registration is what activates server XP, leaderboards, and the server's public page.",
        requirementsHeading: "Requirements",
        req1: "You must be signed in to an OwOGG account.",
        req2: "You must have Manage Server permission on the Discord server you're registering.",
        req3: "The OwOGG app must already be installed on that server.",
        stepsHeading: "Registration steps",
        step1: "While signed in to OwOGG, start Discord server registration verification.",
        step2: "Authorize the permission Discord requests (viewing your server list).",
        step3: "Pick the server to register from the list of servers you manage.",
        step4: "Set the server's slug (URL name), description, and visibility.",
        step5: "Once registration is complete, the server's public page is created instantly.",
        buttonLabel: "Start server registration",
        visibilityHeading: "Visibility",
        visibilityPublicDesc: "Shown in the OwOGG server directory and search.",
        visibilityUnlistedDesc: "Reachable only via a direct link; not shown in the directory.",
        visibilityPrivateDesc: "Accessible only to server admins.",
        calloutStrong: "Installing the app ≠ registering your server.",
        calloutBody:
          " Installing the app doesn't automatically make your server public. You must register it directly using the steps above.",
        footerPrefix: "Server missing from the list? See the ",
        footerLink: "troubleshooting guide",
        footerSuffix: "'s \"Server isn't in the registration candidate list\" section.",
      },
      discordCommands: {
        title: "Commands",
        description: "Every OwOGG Discord command is a subcommand of /owogg.",
        calloutEphemeral:
          "The responses shown are ephemeral — visible only to the user who ran the command, not to anyone else in the channel.",
        labelWhere: "Where to use",
        labelAccountLink: "Account link required",
        labelGuildRequired: "Server registration required",
        labelArgs: "Arguments",
        labelExample: "Example",
        labelCommonError: "Common error: ",
        yes: "Yes",
        no: "No",
        footerPrefix: "Not behaving as expected? Check the ",
        footerLink: "troubleshooting guide",
        footerSuffix: ".",
        commands: [
          {
            purpose: "Links this Discord account to your OwOGG account.",
            where: "Server channel or DM",
            args: "None",
            commonError: "If already linked, you'll get a notice instead of a new link.",
          },
          {
            purpose: "Shows your linked OwOGG account's nickname, level, and total XP.",
            where: "Server channel or DM",
            args: "None",
            commonError: "If your account isn't linked, you'll be pointed to /owogg link.",
          },
          {
            purpose: "Shows the list of games currently playable on OwOGG, with links.",
            where: "Server channel or DM, no sign-in required",
            args: "None",
            commonError: "None (always responds publicly)",
          },
          {
            purpose: "Issues a one-time game play link whose XP is attributed to this server.",
            where: "A registered server channel",
            args: "game (optional) — target a specific game; omit to go to the game list",
            commonError:
              "If the server isn't registered or your account isn't linked, you'll get a notice. The link is valid once, for 15 minutes.",
          },
          {
            purpose: "Shows your rank and contributed XP in this server.",
            where: "A registered server channel",
            args: "None",
            commonError:
              "If your account isn't linked or you have no activity here yet, you'll get a notice.",
          },
          {
            purpose: "Shows this server's top 10 OwOGG XP leaderboard.",
            where: "A registered server channel",
            args: "None",
            commonError: "If the server isn't registered, you'll get a notice.",
          },
          {
            purpose: "Shows this server's total XP and weekly activity summary.",
            where: "A registered server channel",
            args: "None",
            commonError: "If the server isn't registered, you'll get a notice.",
          },
        ],
      },
      discordXp: {
        title: "How Server XP Is Calculated",
        description:
          "Global XP, per-server user XP, and server activity XP are three different numbers.",
        differHeading: "Three different kinds of XP",
        globalTerm: "Regular OwOGG XP (global)",
        globalDesc:
          " — cumulative XP for the whole account. Used in the profile and overall ranking.",
        perGuildTerm: "Per-server Discord user XP",
        perGuildDescPrefix: " — accumulates only from valid completions made in that server via ",
        perGuildDescCode: "/owogg play",
        perGuildDescSuffix: ".",
        guildActivityTerm: "Discord server activity XP",
        guildActivityDesc:
          " — the sum contributed by every member of the server; used for the server leaderboard and weekly ranking.",
        exampleHeading: "Example",
        exampleBodyPrefix: "A user with 25,000 global XP makes one valid completion (+10) via ",
        exampleBodyCode: "/owogg play",
        exampleBodySuffix: " in a newly registered Guild A:",
        cardGlobalTitle: "Global XP",
        cardGlobalText: "Cumulative for the whole account",
        cardGuildATitle: "Guild A user XP",
        cardGuildAText: "Valid contribution made in A",
        cardGuildBTitle: "Guild B",
        cardGuildBText: "Existing XP isn't copied over automatically",
        calloutNoCopyStrong: "Existing global XP is never copied to a new server automatically.",
        calloutNoCopyBody:
          " A newly registered server always starts at 0, accumulating only new valid plays made in that server.",
        calloutAbuseStrong: "Abuse prevention:",
        calloutAbuseBody:
          " Global XP is capped at 10 grants per user × game × UTC day. Once the cap is reached, you can still complete the game, but no additional XP is granted. Each play event can be attributed to at most one server — the same completion never creates duplicate XP across multiple servers.",
        footerPrefix: "For how to view server rankings, see the ",
        footerLink: "games and ranking article",
        footerSuffix: ".",
      },
      discordTroubleshooting: {
        title: "Troubleshooting",
        description:
          "Look up your symptom below. In no case does a regular user need to configure a Bot Token.",
        calloutWarning:
          "None of the symptoms below ever require entering a Bot Token, Application ID, or Public Key. If someone asks you for those, it may not be an official OwOGG channel.",
        faqAutocomplete: {
          question: "/owogg doesn't show up in autocomplete",
          answerPrefix:
            "Try restarting your Discord client, or leaving and rejoining the server. If it still doesn't appear, ask a server admin to confirm the app is actually installed on this server. The OwOGG team can check global command registration status with ",
          answerCode: "pnpm discord:commands:check",
          answerSuffix: ".",
        },
        faqPlainMessage: {
          question: "I typed /owogg link but it posted as a plain message",
          answer:
            "If it was sent as plain text instead of an actual slash command, Discord didn't recognize it as a command. You need to select /owogg from the autocomplete list, then pick the subcommand, and run it that way. Typing and sending it manually just sends a regular message.",
        },
        faqNoResponse: {
          question: "The application did not respond",
          answer:
            "This can be a temporary delay or error. Try again in a moment. If it keeps happening, there may be an issue with OwOGG's service status — please check back shortly.",
        },
        faqAlreadyLinked: {
          question: "It says my account is already linked",
          answer:
            "This Discord account is already registered to another OwOGG account. It remains bound to the first OwOGG account even after unlinking and cannot be registered to a different account.",
        },
        faqServerNotRegistered: {
          question: "/owogg play says the server isn't registered",
          answerPrefix:
            "This Discord server hasn't been registered as an OwOGG community yet. A server admin needs to complete ",
          answerLink: "server registration",
          answerSuffix: ". Installing the app alone doesn't register it.",
        },
        faqNotInCandidateList: {
          question: "The server isn't in the registration candidate list",
          answer:
            "The list of registerable servers only shows servers where you actually have Manage Server permission. Check whether you have that permission, or whether you're signed in to the Discord account you expect.",
        },
        faqBotNotVisible: {
          question: "The bot doesn't appear in the Discord member list",
          answer:
            "OwOGG isn't an always-connected (Gateway) bot — it runs on signed HTTP Interactions. Because of that, it may not always show as \"online\" in the member list — this is normal and doesn't affect whether commands work.",
        },
        faqBotOffline: {
          question: "The bot appears offline",
          answer:
            "Same reason as above. An HTTP Interactions-based app doesn't maintain an always-connected state, so it can appear offline in the Discord member list. If commands run correctly, this isn't a problem.",
        },
        footerPrefix: "Don't see your issue here? Check the FAQ in the ",
        footerLink: "Discord usage guide",
        footerSuffix: " too.",
      },
      support: {
        title: "Contact · Report · Bug Report",
        description: "Reach out on the channel that matches your message — it gets seen faster.",
        generalHeading: "General (contact@owogg.com)",
        generalBody: "Account issues, how-to questions, feature suggestions — anything else.",
        reportHeading: "Report (report@owogg.com)",
        reportBody:
          "Cheating, abuse, inappropriate content, or other community guideline violations.",
        bugHeading: "Bug Report (bug@owogg.com)",
        bugBody:
          "Game errors, broken features, visual glitches. Tell us which game/page and what you were doing when it happened — that helps us confirm it faster.",
        tipsHeading: "General tips",
        tip1: "A screenshot helps a lot if you can attach one.",
        tip2: "For account issues, include the email or nickname you signed up with.",
        tip3: "For reports, include who/what you're reporting and what happened.",
        footerPrefix:
          "To see all three channels in one place and send an email right away, use the ",
        footerLink: "Contact page",
        footerSuffix: ".",
      },
    },
    legal: {
      terms: {
        metaTitle: "Terms of Service",
        metaDescription: "OwOGG Terms of Service",
        pageTitle: "Terms of Service",
        effectiveDate: "Effective Date: August 14, 2026",
        section1Heading: "1. Service Overview",
        section1Body:
          'OwOGG (hereinafter "Service") is a web mini-game collection platform enjoyed directly in the browser without installation, providing additional features such as Discord server integration, rankings/experience points (XP), and Streamer channel verification.',
        section2Heading: "2. Accounts and Login",
        section2Body:
          "The Service only supports OAuth login through Google or Discord accounts and does not directly issue separate IDs/passwords (excluding administrator-exclusive accounts). Users must log in only with accounts they own, and users themselves are responsible for managing their accounts.",
        section3Heading: "3. Obligations of Users",
        section3Intro: "Users shall not engage in the following activities:",
        section3List: [
          "Fraudulently manipulating game records or experience points using automated tools, macros, etc.",
          "Registering or verifying accounts, channels, or Discord servers not owned by oneself as if they were owned by oneself",
          "Collecting or posting others' personal information without authorization, or causing harm to others through the Service",
          "Attacks, excessive requests, or exploiting vulnerabilities that interfere with the normal operation of the Service",
        ],
        section4Heading: "4. Content and Game Records",
        section4Body:
          "Game records, nicknames, and profile information created by users are used for service provision purposes such as rankings/XP. The Service may adjust or delete data deemed as fraudulent records without prior notice.",
        section5Heading: "5. Changes to and Discontinuation of Service",
        section5Body:
          "The Service may change or discontinue games, features, and screen configurations provided as needed for operational or technical reasons without prior notice. The Service is provided free of charge and does not guarantee availability or specific performance.",
        section6Heading: "6. Disclaimer",
        section6Body:
          "The Service is a free personal/small-scale project and is not liable for damages arising from or related to the use of the Service to the extent permitted by applicable laws, except for damages caused by intentional misconduct or gross negligence.",
        section7Heading: "7. Amendments to Terms",
        section7Body:
          "These Terms may be amended when necessary, and notice will be provided on this page upon amendment. The amended Terms shall take effect immediately upon posting.",
        section8Heading: "8. Contact Us",
        section8BodyPrefix: "For inquiries regarding the use of the Service, please contact ",
        section8BodyEmail: "contact@owogg.com",
        section8BodySuffix: ".",
      },
      privacy: {
        metaTitle: "Privacy Policy",
        metaDescription: "OwOGG Privacy Policy",
        pageTitle: "Privacy Policy",
        effectiveDate: "Effective Date: August 14, 2026",
        section1Heading: "1. Personal Information Collected",
        section1Intro: "OwOGG collects only the following information to provide the Service:",
        section1List: [
          {
            term: "Login Information",
            desc: " — Email, nickname (display name), profile picture URL, and unique account identifier (sub/ID) provided when logging in with a Google or Discord account",
          },
          {
            term: "Game Play Records",
            desc: " — Scores/records per game, experience points (XP), level, and achievement history",
          },
          {
            term: "Profile Settings",
            desc: " — Nickname directly entered by the user, country/region (optional, self-reported information, not proof of nationality)",
          },
          {
            term: "Discord Integration Information",
            desc: " — Discord user ID when linking accounts, server ID/name/icon and administrative permissions when registering servers (guilds)",
          },
          {
            term: "Streamer Channel Verification Information",
            desc: " — Channel name, channel URL, subscriber/follower count verified through official APIs of respective platforms (YouTube/Twitch/CHZZK/SOOP) when voluntarily completing channel ownership verification to participate in Streamer rankings",
          },
        ],
        section1Outro:
          "Passwords are not collected separately (administrator-exclusive accounts are an exception, where passwords are stored hashed with PBKDF2 and never stored in plain text).",
        section2Heading: "2. Purpose of Collection",
        section2List: [
          "Member identification and maintaining login state",
          "Providing game records, rankings, and experience point systems",
          "Querying user account information in Discord bot commands and aggregating activity per server",
          "Verifying eligibility for Streamer rankings",
          "Detecting abusive behavior (abuse) and maintaining service stability",
        ],
        section3Heading: "3. Retention Period",
        section3Body:
          "Personal information is retained until member withdrawal or user request for deletion, except where separate retention is required by applicable laws.",
        section4Heading: "4. Provision to Third Parties",
        section4Body:
          "OwOGG does not provide or sell users' personal information to third parties for advertising or marketing purposes. Only infrastructure necessary for service operation (Cloudflare — server/database hosting) is used, which does not constitute provision for third-party marketing.",
        section5Heading: "5. Rights of Users",
        section5Body:
          "Users may request to inspect, correct, or delete (account deletion) their personal information at any time. Please contact the email address below, and we will process it upon verification.",
        section6Heading: "6. Cookies and Sessions",
        section6Body:
          "Session cookies are used to maintain login status. Tracking cookies for advertising purposes or third-party analytics tools are not used.",
        section7Heading: "7. Contact Us",
        section7BodyPrefix: "For inquiries regarding privacy, please contact ",
        section7BodyEmail: "contact@owogg.com",
        section7BodySuffix: ".",
      },
    },
    gamePlay: {
      errorGameNotFound: "Game not found.",
      gameDisabledTitle: "This game is currently unavailable",
      gameDisabledBody: "It's been temporarily disabled by an operator. Please check back later.",
      errorLoadFailed: "An error occurred while loading the game.",
      errorSubmitFailed: "Failed to save your score.",
      errorNetworkSubmitFailed: "A network error prevented your score from being saved.",
      errorSubmitFallback: "Failed to save record",
      backToList: "Back to list",
      back: "Back",
      loadingTitle: "Loading game...",
      loadingBody: "Loading the game...",
      authRequiredTitle: "Sign-in required for this game",
      authRequiredBody:
        "Sign in to play this mini-game and register your score on the leaderboard.",
      authRequiredCta: "Sign in and play",
      resultTitle: "Game Over!",
      finalScoreLabel: "Final score",
      deviceBestLabel: "Device best record",
      metadataWpm: "Speed (WPM)",
      metadataCpm: "Keystrokes (CPM)",
      metadataAccuracy: "Accuracy",
      metadataCorrectChars: "Correct",
      metadataIncorrectChars: "Incorrect",
      metadataTotalTypedChars: "Total typed",
      metadataDurationMs: "Duration (ms)",
      metadataTargetsHit: "Targets hit",
      metadataMisses: "Misses",
      metadataLevel: "Level reached",
      metadataTargets: "Targets",
      metadataAvgPerTargetMs: "Avg. per target (ms)",
      metadataSequenceLength: "Pattern length",
      metadataGrade: "Grade",
      metadataAuthoritativeRawScore: "Verified raw score",
      guestNoticeTitle: "Guest records are saved only on this device.",
      guestNoticeBody: "Sign in to join the leaderboard starting with your next play.",
      guestLoginCta: "Sign in",
      submittingLabel: "Submitting score to leaderboard...",
      successLabel: "Your record has been added to the leaderboard!",
      retrySubmitCta: "Resubmit score",
      leaderboardYou: "You",
      retryGameCta: "🔄 Play again",
      returnToGameCta: "Return to game",
      backToListResult: "Back to list",
      difficultyNormal: "Normal",
      difficultyHard: "Hard",
      shareText: "I scored {score} in {title}! Can you beat it? 🎮",
      shareXCta: "Share on X",
      shareDiscordCta: "Copy for Discord",
      shareDiscordCopiedFeedback: "Copied! Paste it into Discord",
      shareXScreenshotHint: "Screenshot copied! Paste it (Ctrl+V) into the tweet box",
      screenshotCopyCta: "Copy screenshot",
      screenshotCopiedFeedback: "Image copied!",
      screenshotDownloadedFeedback: "Image downloaded",
      screenshotErrorFeedback: "Couldn't create the screenshot",
      leaderboardTitle: "Leaderboard",
      leaderboardEmpty: "No records yet.",
      viewFullRanking: "View full ranking →",
      fullscreenEnterCta: "Fullscreen",
      fullscreenExitCta: "Exit fullscreen",
      fullscreenRecommendedHint: "Recommended",
      mobileExperimentalNotice: "Mobile support is experimental.",
      mobileUnsupportedNotice: "This game may not support mobile devices.",
      orientationPortraitHint: "This game is optimized for portrait orientation.",
      orientationLandscapeHint: "This game is optimized for landscape orientation.",
      bookmarkCta: "Bookmark",
      bookmarkedCta: "Bookmarked",
      shareGameCta: "Share",
      shareGameCopied: "Link copied",
      feedbackCta: "Feedback",
      mobilePlayCta: "Play on mobile",
      theaterModeEnterCta: "Theater mode",
      theaterModeExitCta: "Default view",
      adLabel: "Advertisement",
      adPlaceholder: "Reserved ad inventory that keeps the content layout stable.",
      recommendedGamesTitle: "Play next",
      recommendedGamesEmpty: "There are no other public games to recommend yet.",
      gameInfoTitle: "About this game",
      publisherLabel: "Publisher",
      publishedLabel: "Uploaded",
      playerStatsLabel: "Players",
      bookmarkStatsLabel: "Bookmarks",
      officialGameBadge: "Official game",
      userGameBadge: "Community game",
      mobilePlayTitle: "Continue on your phone",
      mobilePlayBody:
        "Copy or share the link below, then open the same game in your mobile browser.",
      copyGameLinkCta: "Copy game link",
      closeDialogCta: "Close",
      gameLinkCopied: "Game link copied.",
    },
    gameRanking: {
      eyebrow: "Game Ranking",
      backToGame: "Back to game",
      notSupported: "This game doesn't support ranking",
      notSupportedBody: "It's a casual game meant to be played without a scoreboard.",
    },
    userProfile: {
      eyebrow: "Player Profile",
      backToHome: "Back to home",
      notFoundTitle: "User not found",
      notFoundBody: "This account doesn't exist or has been deleted.",
      loadErrorBody: "Couldn't load this profile.",
      retryButton: "Retry",
      joinedPrefix: "Joined",
      levelLabel: "Level",
      globalRankPrefix: "Global XP Rank #",
      streakLabel: "Current streak",
      streakDaysSuffix: " days",
      longestStreakPrefix: "Best",
      achievementsTitle: "Achievements",
      achievementsEmpty: "No achievements unlocked yet.",
      achievedSuffix: "unlocked",
      gameRecordsTitle: "Best records by game",
      gameRecordsEmpty: "No records yet.",
      streamerBadgesTitle: "Verified streamer channels",
      manageProfileCta: "Settings →",
      favoritesTitle: "Favorites",
      favoritesEmpty: "No favorite games yet.",
      recentPlaysTitle: "Recent Plays",
      recentPlaysEmpty: "No plays recorded yet.",
      itemsCountSuffix: "",
      onlyVisibleToYou: "Only you",
      settingsCta: "Change in settings",
    },
    registeredServers: {
      ariaLabel: "Registered Discord servers",
      title: "Registered Servers",
      empty: "No servers registered yet.",
      viewAll: "View all servers →",
    },
    changelog: {
      eyebrow: "Changelog",
      title: "Changelog",
      subtitle: "See what's new and what's changed on OwOGG.",
      emptyState: "No updates yet.",
      tagFeature: "New",
      tagImprovement: "Improved",
      tagFix: "Fixed",
    },
    platformIcon: {
      chzzkLabel: "CHZZK",
      soopLabel: "SOOP",
      channelSuffix: "channel",
      verifiedPlatforms: "Verified platforms",
    },
    contact: {
      eyebrow: "Contact",
      title: "How can we help?",
      subtitle: "Pick the channel that matches your message — it gets seen faster that way.",
      emailCta: "Copy email address",
      emailCopiedFeedback: "Copied!",
      generalLabel: "General",
      generalDesc: "Account, how-to, suggestions, anything else",
      reportLabel: "Report",
      reportDesc: "Cheating, abuse, inappropriate content",
      bugLabel: "Bug Report",
      bugDesc: "Game errors, broken features, other bugs",
      guidanceTitle: "Before you write in",
      guidanceItems: [
        "For bugs, tell us which game/page and what you were doing when it happened.",
        "A screenshot helps a lot if you can attach one.",
        "For account issues, include the email or nickname you signed up with.",
        "For reports, include who/what you're reporting and what happened.",
      ],
      discordAltTitle: "You can also reach us on Discord",
      discordAltBody:
        "For faster back-and-forth, check the Discord guide for our community server.",
      discordAltCta: "View the Discord guide",
    },
  },
  "ja-JP": {
    common: {
      loading: "読み込み中...",
      error: "問題が発生しました。",
      retry: "再試行",
      empty: "表示する項目がありません。",
      save: "保存",
      cancel: "キャンセル",
    },
    nav: {
      searchPlaceholder: "ゲーム名、タグ、カテゴリで検索...",
      favorites: "お気に入り",
      login: "ログイン",
      logout: "ログアウト",
      myProfile: "プロフィール",
      settings: "設定",
      ranking: "殿堂入り",
      wiki: "Wiki",
      accountSuffix: "アカウント",
    },
    sidebar: {
      openMenuAria: "メニューを開く",
      expandMenuAria: "サイドバーを展開",
      collapseMenuAria: "サイドバーを折りたたむ",
      mobileMenuTitle: "メニュー",
      home: "ホーム",
      allGames: "全ゲーム",
      popularGames: "人気ゲーム",
      rankingRecords: "ランキング＆記録",
      otherHeading: "その他",
      discordHub: "Discord",
      moreHeading: "もっと見る",
      favorites: "お気に入り",
      discordServers: "登録済みDiscordサーバー",
    },
    footer: {
      tagline: "インストール不要、すぐに遊べるミニゲーム",
      allGames: "全ゲーム一覧",
      ranking: "殿堂入り",
      wiki: "Wiki",
      changelog: "更新履歴",
      contactUs: "お問い合わせ",
      rightsReserved: "All rights reserved.",
    },
    home: {
      heroEyebrow: "インストール不要ですぐプレイ",
      heroTitle: "退屈する暇なし、ゲームを一か所に",
      heroSubtitle: "軽量なWebミニゲームを集めて楽しみ、友達と記録を競いましょう。",
      browseGames: "ゲームを見る",
      lineupTitle: "ミニゲームラインナップ",
      itemsCountSuffix: "個",
      popularTitle: "人気ゲーム",
      recentPlaysTitle: "最近プレイ",
      favoritesTitle: "お気に入り",
      emptyCategory: "このカテゴリにはまだ用意されたゲームがありません。",
      gridColumnsAriaPrefix: "",
      gridColumnsAriaSuffix: "列で表示",
      teaserTitle: "リアルタイムランキング＆マルチプレイヤーアップデート予定",
      teaserBody:
        "友達と1つのリンクで参加し、リアルタイムで対戦できるマルチプレイヤーモードが近日公開予定です。",
      teaserCta: "ゲームをプレビュー",
    },
    language: { label: "言語", ko: "한국어", en: "English", ja: "日本語", zh: "简体中文" },
    loginModal: {
      title: "OwOGG にログイン",
      subtitle: "ソーシャルアカウントを選ぶと安全にログインできます。",
      close: "閉じる",
      googleButton: "Googleアカウントでログイン",
      googleLoading: "Googleでログイン中...",
      googleUnconfigured: "Googleログインはまだ設定されていません。",
      discordButton: "Discordアカウントでログイン",
      discordLoading: "Discordでログイン中...",
      discordUnconfigured: "Discordログインはまだ設定されていません。",
      providerChecking: "ログインサーバーの設定を確認しています。",
      providerUnavailable: "ログインサーバーに接続できません。",
      retry: "再確認",
    },
    games: {
      eyebrow: "Game Collection",
      title: "全ミニゲーム",
      countSuffix: "個の軽量ミニゲームが用意されています。",
      searchPlaceholder: "ゲームを検索...",
      emptyFavorites: "まだお気に入りのゲームがありません。",
      emptySearch: "検索結果に一致するゲームがありません。",
      sortLabel: "ゲームの並び順",
      sortOptions: {
        popular: "人気順",
        newest: "公開順",
        players: "閲覧数順",
        bookmarks: "お気に入り数順",
      },
      playerCountLabel: "プレイしたユーザー",
      bookmarkCountLabel: "お気に入りユーザー",
      categories: {
        all: "すべて",
        popular: "人気",
        reaction: "反射神経",
        brain: "頭脳",
        aim: "エイム",
        typing: "タイピング",
        favorites: "お気に入り",
      },
      addFavoriteAriaPrefix: "",
      addFavoriteAriaSuffix: "をお気に入りに追加",
      removeFavoriteAriaPrefix: "",
      removeFavoriteAriaSuffix: "のお気に入りを解除",
    },
    ranking: {
      eyebrow: "Leaderboard & Community Hall of Fame",
      title: "殿堂入り",
      subtitle: "最高記録、ユーザー活動レベル、認証済みストリーマーランキングです。",
      gameTab: "一般ランキング",
      xpTab: "経験値ランキング",
      streamerTab: "ストリーマーランキング",
      allCategories: "全種目",
      allPlatforms: "全プラットフォーム",
      platformChzzk: "CHZZK",
      platformSoop: "SOOP",
      scoreMode: "ゲームスコア",
      xpMode: "経験値 (XP)",
      streakMode: "連続ログイン",
      dailyPeriod: "日間",
      weeklyPeriod: "週間",
      monthlyPeriod: "月間",
      rankHeader: "順位",
      playerHeader: "プレイヤー",
      streamerHeader: "ストリーマー",
      countryHeader: "国・地域",
      categoryHeader: "種目",
      recordHeader: "記録",
      dateHeader: "達成日",
      modeHeader: "モード",
      levelHeader: "レベル",
      totalXpHeader: "総経験値",
      recordOrCategory: "記録 / 種目",
      activityLevel: "活動レベル (XP)",
      badgeHeader: "バッジ",
      platformHeader: "プラットフォーム",
      emptyGames: "まだ登録された記録がありません。最初の記録に挑戦しましょう。",
      emptyXp: "まだ活動履歴のあるユーザーがいません。",
      emptyStreak: "現在継続中の連続ログイン記録はありません。",
      unknownCountry: "国・地域が未設定または非公開",
      emptyStreamerTitle: "まだ認証済みストリーマーがいません",
      emptyStreamerBody:
        "この期間とフィルターに合う認証済みストリーマーのゲーム記録・XP・連続ログイン記録はまだありません。",
      retryButton: "再試行",
      rank1: "1位",
      rank2: "2位",
      rank3: "3位",
    },
    profile: {
      pageTitle: "設定",
      pageSubtitle: "アカウント情報と公開範囲を管理します。",
      visibilityTitle: "公開範囲",
      visibilitySubtitle: "他の人がプロフィールを開いたときに表示する項目を選びます。",
      visibilityFavoritesLabel: "お気に入り",
      visibilityRecentPlaysLabel: "最近のプレイ",
      visibilityPublicOption: "公開",
      visibilityPrivateOption: "非公開",
      visibilityUpdated: "公開範囲を保存しました。",
      visibilityUpdateFailed: "公開範囲を保存できませんでした。",
      joinedLabel: "登録日",
      viewProfileCta: "プロフィールを見る",
      logout: "ログアウト",
      favoritesTitle: "お気に入り",
      emptyFavorites:
        "まだお気に入りのゲームがありません。ゲームカードのブックマークアイコンを押して追加しましょう。",
      recentPlaysTitle: "最近プレイしたゲーム",
      achievementsTitle: "実績",
      emptyAchievements:
        "まだ達成した実績がありません。ゲームをプレイしてお気に入りを追加してみましょう！",
      noRecordLabel: "アカウント記録なし",
      deviceRecordLabel: "端末記録",
      noRecordYetHint: "まだ記録がありません — 今すぐ挑戦してみましょう！",
      justNow: "たった今",
      minutesAgoSuffix: "分前",
      hoursAgoSuffix: "時間前",
      daysAgoSuffix: "日前",
      linkSuccess: "ログイン方法が連携されました。",
      alreadyLinkedAccount: "すでに連携済みのアカウントです。",
      linkError: "ログイン方法の連携中にエラーが発生しました。",
      streamerVerifySuccess: "ストリーマーチャンネルの所有権認証が完了しました。",
      streamerVerifyConflict:
        "このチャンネルはすでに別のOwOGGストリーマーアカウントに連携されています。",
      streamerVerifyUnconfigured: "現在このプラットフォームの認証は利用できません。",
      streamerVerifyUnauthorized: "ログインの有効期限が切れました。再度ログインしてください。",
      streamerVerifyError: "ストリーマーチャンネル認証中にエラーが発生しました。",
      googleScriptNotReady: "Googleログインスクリプトの準備ができていません。",
      googleLinkSuccess: "Googleログインが連携されました。",
      googleAccountInUse: "このGoogleアカウントはすでに別のOwOGGアカウントで使用されています。",
      googleAlreadyLinked: "このアカウントにはすでにGoogleログインが連携されています。",
      googleLinkFailed: "Google連携に失敗しました。",
      unlinkSuccessSuffix: "の連携が解除されました。",
      lastAuthProviderError: "最後のログイン方法は解除できません。",
      unlinkFailed: "連携解除に失敗しました。",
      mergeCompleted: "アカウント統合が完了しました。",
      nicknameUpdated: "ニックネームが変更されました。",
      nicknameCooldownPrefix: "ニックネームは",
      nicknameCooldownSuffix: "以降に再度変更できます。",
      nicknameUpdateFailed: "ニックネームの変更に失敗しました。",
      nicknamePolicyHint:
        "ニックネームは重複可能で、公開画面では「ニックネーム #ユーザー番号」と表示されます。変更後30日間は再変更できません。",
      nicknamePreviewLabel: "公開表示",
      avatarTitle: "プロフィール画像",
      avatarSubtitle: "連携済みのGoogleまたはDiscordアカウントの画像から選択します。",
      avatarUseButton: "この画像を使用",
      avatarSelected: "現在使用中",
      avatarUpdated: "プロフィール画像を変更しました。",
      avatarUpdateFailed: "プロフィール画像を変更できませんでした。",
      avatarUnavailable: "使用できる画像がありません。",
      countryUpdated: "国/地域が変更されました。",
      countryCooldownPrefix: "国/地域は",
      countryCooldownSuffix: "以降に再度変更できます。",
      countryUpdateFailed: "国/地域の変更に失敗しました。",
      loginRequiredTitle: "ログインが必要なページです",
      loginRequiredBody: "GoogleまたはDiscordアカウントでログインしてゲーム記録を管理しましょう。",
      loginRequiredCta: "ログインする",
      backButton: "前のページに戻る",
      levelLabel: "レベル",
      globalXpRankPrefix: "全体XPランキング #",
      totalXpPrefix: "合計 ",
      settingsTitle: "プロフィール設定",
      nicknameLabel: "ニックネーム",
      nicknamePlaceholder: "ニックネームを入力してください",
      changeButton: "変更",
      countryLabel: "国/地域",
      countryHint: "（任意、自己申告情報であり国籍認証ではありません）",
      countryNotSet: "設定しない",
      itemsCountSuffix: "件",
      emptyRecentPlays: "まだプレイ記録がありません。ゲームをプレイするとここに表示されます。",
      connectedAccountsTitle: "連携中のログインアカウント",
      linkedStatus: "連携済み",
      notLinkedStatus: "未連携",
      unlinkButton: "連携解除",
      linkButton: "連携する",
      streamerVerificationTitle: "ストリーマーチャンネル所有権認証",
      streamerVerificationSubtitle:
        "公式OAuth/APIを通じて、当該チャンネルを直接所有していることを検証します。（自己申告のテキスト入力やWebスクレイピングは禁止）",
      ownershipVerified: "所有権認証済み",
      unverified: "未認証",
      verifiedConfirmedText:
        "✓ OwOGGが公式APIを通じてこのユーザーのチャンネル所有権を確認しました。",
      audienceCountLabel: "登録者/フォロワー",
      audienceUnit: "人",
      metricsSyncedPrefix: "・指標同期",
      verifyChannelCta: "チャンネル所有権認証",
      verifyUnavailable: "現在認証を利用できません",
      featuredReviewStatusTitle: "Featured審査状況",
      featuredStreamerLabel: "★ Featured Streamer",
      featuredSelectedSuffix: "選定",
      featuredHint:
        "Featuredは公式チャンネル指標に基づく資格（登録者/フォロワー12,000人以上・チャンネル開設120日以上）であり、ゲームスコア・XP・ランキング順位には影響しません。",
      achievedSuffix: "達成",
      myGameRecordsTitle: "自分のゲーム別最高記録",
      challengeSuffix: "挑戦",
      viewFullRankingArrow: "全体ランキングを見る →",
      reviewNotStarted:
        "チャンネル所有権認証完了後、自動審査が開始されます。（約6時間後に初回審査）",
      autoReviewPending: "自動審査待機中",
      nextReviewPrefix: "（次回審査",
      notEligible: "現在基準未達",
      manualReviewNeeded: "追加確認が必要",
      autoReviewFailed: "自動審査が一時的に失敗しました（再試行待ち）",
      nextRetryPrefix: "— 次回再試行",
    },
    discord: {
      heroTitle1: "友達とゲーム記録を",
      heroTitle2: "競い合い、交流しよう",
      heroSubtitle:
        "OwOGG Discord Botを自分のサーバーに登録して、コミュニティ専用のリーダーボードとサーバー専用ページを構築しましょう。",
      installCta: "DiscordにOwOGGを追加",
      setupCta: "🧭 セットアップガイド（5ステップ）",
      searchCta: "🔍 サーバー検索",
      registerCta: "⚡ サーバー登録（管理者権限が必要）",
      guideCta: "📖 Discord利用ガイド",
      managedServersTitle: "🛡️ 管理中の登録サーバー",
      exploreAll: "すべて見る →",
      loadingServers: "サーバーリストを読み込み中...",
      noManagedServers: "管理中の登録サーバーがありません",
      loginRequired: "ログインが必要です",
      registerPrompt:
        "Discordの管理者権限があるサーバーをOwOGGに登録してコミュニティを始めましょう。",
      registerStart: "サーバー登録を始める",
      publicPage: "公開ページ",
      manageServer: "サーバー管理",
      registeredLabel: "登録日",
      weeklyRankingTitle: "今週のサーバー活動ランキング",
      loadingRanking: "ランキングを読み込み中...",
      emptyWeeklyRanking: "今週登録されたサーバー活動がありません",
      guideTitle: "📌 利用案内",
      guideStep1: "サーバー登録はDiscord管理者（MANAGE_GUILD）権限を持つユーザーのみ可能です。",
      guideStep2: "公開（PUBLIC）登録時はOwOGGディレクトリと検索に表示されます。",
      guideStep3:
        "/owogg playでゲームをプレイすると、このサーバーにXPが貢献され週間ランキングに集計されます。",
      accountLinkTitle: "🔗 Discordアカウント連携",
      accountLinkBody:
        "OwOGGアカウントとDiscordアカウントを連携すると、ボットコマンド（/owogg profile）で自分の情報を確認できます。",
      accountLinkCta: "アカウント連携ページへ",
      usageGuideCta: "Discordの使い方を見る",
    },
    discordSetup: {
      eyebrow: "OwOGG × Discord",
      title: "Discordセットアップガイド",
      subtitle:
        "以下の5ステップに従うだけで、サーバーですぐにOwOGGを使えます。Bot TokenやApplication IDのような値は不要です — それらはOwOGG運営のみが扱います。",
      step1Title: "DiscordにOwOGGを追加",
      step1Description:
        "サーバー管理者権限のあるアカウントでDiscordアプリをサーバーにインストールします。",
      checkingInstallLink: "インストールリンクを確認中...",
      installLinkUnavailable:
        "インストールリンクがまだ準備できていません。サーバー管理者に公式インストールリンクを確認してください。",
      installNote:
        "Discordアプリのインストールと、OwOGGサーバー登録（3ステップ目）は異なります — インストールだけではサーバーが自動登録されません。",
      installStatusHint:
        "このバッジは自動で確認できないため常にこの表示になります — すでにインストール済みでも正常です。サーバーのメンバー一覧にOwOGGが表示されていればインストールは完了しています。",
      step2Title: "Discordアカウント連携",
      step2Description:
        "Discordのボットコマンドで自分のOwOGG情報を使えるようアカウントを連携します。",
      checking: "確認中...",
      owoggLoginCta: "OwOGGにログイン",
      linkedNote1: "連携済みです。Discordで",
      linkedNote2: "を使用できます。",
      linkAccountCta: "アカウント連携ページへ",
      step3Title: "サーバー登録",
      step3Description:
        "Discordサーバー管理（MANAGE_GUILD）権限があるサーバーをOwOGGコミュニティとして登録します。",
      loginFirst: "まずOwOGGにログインしてください。",
      alreadyRegisteredPrefix: "すでに",
      alreadyRegisteredSuffix: "個のサーバーを登録・管理しています。",
      registerStartCta: "サーバー登録を開始",
      viewServerDirectory: "サーバーディレクトリを見る",
      step4Title: "/owogg games をテスト",
      step4Description: "Discordチャンネルでスラッシュコマンドが正しく自動補完されるか確認します。",
      notShowingUp: "自動補完に表示されない場合は",
      troubleshootingGuide: "トラブルシューティングガイド",
      checkSuffix: "をご確認ください。",
      step5Title: "/owogg play で開始",
      step5Description: "このサーバーに紐づくプレイリンクを発行し、サーバーXPを貯め始めます。",
      viewFullGuide: "利用ガイド全体を見る",
      footerNote1:
        "一般ユーザーはBot Token、Application ID、Public Keyを入力する必要はありません。詳しくは",
      discordWikiLink: "Discord Wiki",
      footerNote2: "をご確認ください。",
      badgeDone: "完了",
      badgeTodo: "対応が必要",
      badgeUnknown: "自分で確認",
    },
    discordGuide: {
      eyebrow: "OwOGG × Discord",
      heroTitle: "DiscordでOwOGGを使う",
      heroSubtitle:
        "サーバーでゲームを開始し、自分の活動をサーバーXPとリーダーボードで確認しましょう。OwOGGは常駐Gatewayボットではなく、署名付きHTTP Interactionsで動作します。",
      installCta: "Discordに追加",
      installLinkHint: "インストールリンクはサーバー管理者の案内を確認してください",
      serverDirectoryCta: "サーバーディレクトリ",
      heroSetupCta: "5ステップセットアップガイド",
      onboardingEyebrow: "ONBOARDING",
      onboardingTitle: "インストール・アカウント連携・サーバー登録はお済みですか？",
      onboardingBody:
        "インストールからアカウント連携、サーバー登録までの5ステップの進捗をリアルタイムのチェックリストで確認し、続きからすぐ再開できます。",
      onboardingCta: "5ステップセットアップガイドを開く",
      xpTitle: "サーバーXPの計算方法",
      xpSubtitle: "グローバルXPとサーバーXPは同じ数値をコピーする仕組みではありません。",
      xpGlobalTitle: "グローバルXP",
      xpGlobalText: "OwOGG全体の進行度",
      xpGuildATitle: "Guild Aユーザー XP",
      xpGuildAText: "Aで作られた有効な貢献",
      xpGuildBTitle: "Guild B",
      xpGuildBText: "既存のXPは自動コピーされない",
      antiAbuseLabel: "不正防止：",
      antiAbuseText:
        "ユーザー×ゲーム×UTC1日単位でグローバルXPの付与は最大10回までです。上限に達してもゲームの完了は可能ですが、追加のXPは付与されません。",
      commandsTitle: "コマンド",
      commandGamesDesc: "プレイ可能なゲーム一覧を確認します。",
      commandLinkDesc: "DiscordアカウントとOwOGGアカウントを連携します。",
      commandProfileDesc: "連携したアカウントのプロフィール、レベル、グローバルXPを確認します。",
      commandPlayDesc: "サーバーに紐づく1回限りのゲームプレイリンクを作成します。",
      commandRankDesc: "現在のサーバーでの自分のXPと順位を確認します。",
      commandLeaderboardDesc: "現在のサーバーXP Top 10を確認します。",
      commandServerDesc: "サーバー全体のXPと週間活動を確認します。",
      rankingGuideTitle: "サーバーランキングを見る",
      rankingGuideP1:
        "サーバーページでサーバーXP、週間サーバーXP、ゲーム別サーバー参加者記録を確認できます。",
      rankingGuideP2:
        "公開のグローバルサーバー活動ランキングには`PUBLIC`のアクティブなサーバーのみが表示されます。参加者数はOwOGGの活動を作成したユーザー基準であり、Discordの全メンバー数ではありません。",
      viewFullRankingCta: "OwOGG全体ランキングを見る",
      helpGuideTitle: "トラブルシューティング",
      helpP1:
        "サーバーが登録されていないというメッセージが出る場合、管理者がサーバー登録を完了しているか確認してください。",
      helpP2:
        "アカウント連携エラーの場合は`/owogg link`を再実行し、期限切れでないリンクで再確認してください。",
      helpP3:
        "プレイリンクが期限切れ、またはすでに使用済みの場合は新しいリンクを発行する必要があります。",
      faqTitle: "よくある質問",
      faq1Q: "アプリをインストールするとサーバーは自動的に公開されますか？",
      faq1A:
        "いいえ。アプリのインストールとOwOGGサーバー登録は別のものです。管理者がWeb上でギルドを確認し、公開設定を自分で選ぶ必要があります。",
      faq2Q: "OwOGGはDiscordサーバーの全メンバーを取得しますか？",
      faq2A:
        "いいえ。公式OAuthで管理可能なギルドを確認し、XPランキングにはOwOGGの活動を作成した参加者のみを使用します。",
      faq3Q: "既存のグローバルXPを一括でサーバーに取り込めますか？",
      faq3A:
        "いいえ。新しいGuildは0から始まり、`/owogg play`で作られた有効な完了のみがサーバーに紐づきます。",
      faq4Q: "常駐のボットプロセスを実行する必要はありますか？",
      faq4A:
        "v1では不要です。Discord HTTP InteractionsエンドポイントとCloudflare Workerがリクエストを処理します。",
      footerNote: "より詳しい運用手順はDiscord Bot運用ガイドをご確認ください。",
      footerHubCta: "Discord Hubへ移動",
    },
    discordServers: {
      pageTitle: "🔍 Discordサーバーディレクトリ",
      pageSubtitle:
        "OwOGGに登録されたDiscordコミュニティサーバーを探すか、自分のサーバーを新しく登録しましょう。",
      registerCta: "🏰 自分のサーバーを登録する",
      searchPlaceholder: "サーバー名またはvanity slugで検索...",
      searchButton: "検索",
      statusNoGuilds: "管理者（MANAGE_GUILD）権限のあるDiscordサーバーが見つかりません。",
      statusUnauthorized: "サーバー登録にはログインが必要です。",
      statusError: "Discord認証中にエラーが発生しました。もう一度お試しください。",
      candidateLoadError:
        "登録可能なサーバー一覧を読み込めません。トークンが期限切れか、すでに使用されています。",
      guildListFetchError: "サーバー一覧の取得に失敗しました",
      registerFailError: "サーバー登録に失敗しました",
      modalTitle: "🏰 Discordサーバー登録",
      successTitle: "サーバーの登録が完了しました！",
      viewPublicPage: "公開ページを見る",
      manageServer: "サーバーを管理する",
      step1Label: "1. 登録するサーバーを選択（管理中のギルド）",
      step2Label: "2. Vanity Slugアドレスの設定（任意）",
      slugPlaceholder: "自動生成（英小文字、数字、-）",
      step3Label: "3. 公開範囲を選択",
      cancelButton: "キャンセル",
      submittingButton: "登録中...",
      submitButton: "サーバー登録を完了",
      totalCountPrefix: "合計",
      totalCountSuffix: "件の公開サーバーが登録されています。",
      searchTermLabel: "検索キーワード：",
      loadingList: "サーバー一覧を読み込み中...",
      emptyResultsTitle: "検索条件に合う公開サーバーがありません。",
      emptyResultsHint: "別のキーワードで検索するか、新しいサーバーを登録してみてください。",
      owoggServerLabel: "OwOGGサーバー",
      viewPageArrow: "ページを見る →",
    },
    discordServerSlug: {
      loadFailedGeneric: "サーバー情報を読み込めません。",
      loadingServer: "サーバー情報を読み込み中...",
      privateServerTitle: "非公開（PRIVATE）サーバー",
      notFoundTitle: "サーバーが見つかりません",
      privateServerMessage:
        "このサーバーはPRIVATEに設定されており、権限のある管理者のみアクセスできます。",
      backToDirectory: "← ディレクトリに戻る",
      manageServerCta: "⚙️ サーバー管理",
      participantsLabel: "OwOGG参加メンバー",
      participantsUnit: "人",
      participantsHint: "貢献した実績ユーザー数",
      totalXpLabel: "サーバー累計XP",
      totalXpHint: "全ゲーム活動の合計",
      weeklyXpLabel: "今週のサーバーXP",
      weeklyXpHint: "月曜日00:00 KST基準",
      leaderboardTitle: "サーバーリーダーボード",
      tabAlltime: "⚡ サーバーXP",
      tabWeekly: "📅 週間XP",
      tabGames: "🎮 ゲーム別記録",
      emptyAlltimeTitle: "このサーバーにはまだ累計XPがありません",
      emptyAlltimeHintPrefix: "Discordチャンネルで",
      emptyAlltimeHintSuffix: "コマンドを実行してゲームに貢献してみましょう！",
      emptyWeeklyTitle: "今週このサーバーに累計されたXPがありません",
      emptyWeeklyHint: "月曜日00:00 KST以降に最初のプレイを始めて週間ランクを獲得しましょう！",
      loadingGame: "ゲームを読み込み中...",
      emptyGameScoreSuffix: "に記録されたサーバーメンバーのスコアがありません",
      emptyGameHintPrefix: "Discordチャンネルで",
      emptyGameHintSuffix: "コマンドで挑戦してみましょう！",
      infoCardTitle: "OwOGGサーバー情報",
      statusLabel: "ステータス",
      visibilityLabel: "公開範囲",
    },
    discordServerManage: {
      noPermissionError:
        "このサーバーを管理する権限がありません。Discord管理者アカウントでログインしているか確認してください。",
      saveFailedError: "設定の保存に失敗しました",
      unregisterFailedError: "サーバー解除に失敗しました",
      loadingManageInfo: "サーバー管理情報を読み込み中...",
      accessDeniedTitle: "アクセス権限がありません",
      backToDirectory: "← ディレクトリへ移動",
      manageTitleSuffix: "サーバー管理",
      manageSubtitle: "公開/非公開の公開範囲、カスタムVanity Slugアドレス、説明文を設定できます。",
      publicPageArrow: "公開ページ →",
      saveSuccessMessage: "設定が正常に保存されました。",
      slugLabel: "Vanity Slugアドレス（英小文字、数字、-）",
      slugHintPrefix: "変更してもDiscord Guild ID（",
      slugHintSuffix: ")自体は変更されません。",
      visibilityLabel: "サーバー公開範囲（Visibility）",
      visibilityPublicDesc: "検索に表示され、公開ページにアクセス可能",
      visibilityUnlistedDesc: "検索には表示されず、直接リンクでアクセス可能",
      visibilityPrivateDesc: "検索に表示されず、管理者のみアクセス可能",
      descriptionLabel: "サーバー説明文",
      descriptionPlaceholder: "サーバーの特徴やコミュニティ紹介文を入力してください...",
      savingButton: "保存中...",
      saveButton: "設定を保存",
      dangerZoneTitle: "危険区域（Danger Zone）",
      dangerZoneText:
        "サーバー登録を解除すると、OwOGGディレクトリから除外され`DISABLED`状態になります。（Discordサーバー自体には影響しません）",
      unregisterButton: "サーバー登録解除",
      unregisterConfirmTitle: "サーバー登録を解除しますか？",
      unregisterConfirmBodySuffix: "サーバーがOwOGGディレクトリと検索から除外されます。",
      cancelButton: "キャンセル",
      unregisteringButton: "解除中...",
      confirmUnregisterButton: "確認（解除する）",
    },
    discordLink: {
      checkingLinkInfo: "連携情報を確認中...",
      invalidTitle: "無効な連携リンクです",
      invalidBodyPrefix: "リンクが期限切れか、すでに使用されています。Discordサーバーで",
      invalidBodySuffix: "を再度実行してください。",
      linkingInProgress: "Discordアカウントを連携中...",
      errorTitle: "連携に失敗しました",
      genericErrorMessage: "連携中にエラーが発生しました。",
      alreadyLinkedTitle: "すでに連携済みです",
      linkedTitle: "Discordアカウントが連携されました",
      successBodyPrefix: "これでDiscordで",
      successBodySuffix: "コマンドを使ってOwOGGアカウント情報を確認できます。",
      goToProfileCta: "マイプロフィールへ移動",
      linkAccountTitle: "Discordアカウント連携",
      confirmPromptPrefix: "Discordアカウント",
      confirmPromptSuffix: "を現在ログイン中のOwOGGアカウントと連携しますか？",
      loginRequiredHint: "連携するには、まずOwOGGにログインしてください。",
      loginCta: "ログインする",
      linkCta: "連携する",
    },
    wiki: {
      navGettingStarted: "はじめに",
      navDiscordOverview: "Discord概要",
      navDiscordInstall: "インストール",
      navDiscordAccountLink: "アカウント連携",
      navDiscordServerRegistration: "サーバー登録",
      navDiscordCommands: "コマンド",
      navDiscordXp: "サーバーXP",
      navDiscordTroubleshooting: "トラブルシューティング",
      navAccount: "アカウント",
      navAccountOverview: "アカウント概要",
      navAccountMerge: "アカウント統合",
      navGamesRanking: "ゲームとランキング",
      navGamesOverview: "ゲーム概要",
      navRanking: "ランキング",
      navGamesXp: "XPとレベル",
      navGamesDevelopment: "게임 개발 및 등록",
      navStreamerOverview: "Streamer概要",
      navStreamerVerification: "チャンネル所有権認証",
      navStreamerFeatured: "Featured Streamer",
      navSupport: "サポート",
      catSupportDesc: "お問い合わせ・通報・不具合報告チャンネルのご案内",
      tocAriaLabel: "Wiki目次",
      homeTitle: "知りたいことをすぐに見つけよう",
      homeSubtitle:
        "Discordのインストールからランキングの計算方法まで、OwOGGを使うために必要な説明を一箇所にまとめました。",
      homeInstallPrompt: "もっと早くDiscordをインストールしたいですか？",
      homeInstallGuideLink: "5ステップのインストールガイド",
      homeInstallGuideSuffix: "へ直接移動しましょう。",
      catDiscordDesc:
        "サーバーへのインストール、アカウント連携、サーバー登録、コマンド、サーバーXP、トラブルシューティング。",
      catGettingStartedDesc: "OwOGGアカウントの作成から最初のゲームまで、最短ルート。",
      catAccountDesc:
        "ログイン方法、プロフィール設定、複数アカウントを1つに統合するアカウント統合。",
      catGamesDesc: "ゲームカタログ、順位の計算方法、経験値（XP）とレベル。",
      catStreamerDesc: "チャンネル所有権認証、ストリーマーランキング資格、Featured Streamer基準。",
      catPolicyTitle: "ポリシー",
      catPolicyDesc: "利用規約とプライバシーポリシーをご確認ください。",
    },
    wikiBody: {
      streamer: {
        title: "Streamer 概要",
        description:
          "公式OAuth/APIでチャンネル所有権を検証したストリーマー・YouTuberをOwOGG Streamerとして認定します。",
        intro:
          "Streamer認証はゲームスコアやXPに一切の加点を与えません。代わりに、殿堂のストリーマーランキングタブへの掲載、プロフィールの認証バッジと公式チャンネルリンクの表示という特典があります。",
        cardVerification: "チャンネル所有権認証 →",
        cardVerificationDesc: "対応プラットフォームと認証方法",
        cardFeatured: "Featured Streamer →",
        cardFeaturedDesc: "Featured 資格基準",
        profileHint: "認証はプロフィールページから開始できます。",
        profileLink: "プロフィールへ移動",
      },
      streamerVerification: {
        title: "チャンネル所有権認証",
        description:
          "公式OAuthとAPIのみで所有権を検証します。テキスト入力やスクレイピングは一切使用しません。",
        platformsHeading: "対応プラットフォーム",
        conditionsHeading: "認証条件",
        condOnePrefix: "上記4つのプラットフォーム（YouTube · CHZZK · SOOP · Twitch）のうち",
        condOneStrong: "1つだけ",
        condOneSuffix:
          "認証に成功すればOwOGG Streamerとして認定され、4つすべてを認証する必要はありません。",
        condNoMinimum:
          "現在、登録者・フォロワー数やチャンネル開設期間の最低基準は設けていません。チャンネル所有権が公式OAuthで確認できれば十分です。",
        condOauthOnly:
          "所有権認証は常に各プラットフォームの公式OAuthログイン画面を通じてのみ行われ、チャンネルURLやニックネームを直接入力する方式には対応していません。",
        condOneChannelOneAccount:
          "1つの外部チャンネルは1つのOwOGGアカウントにのみ連携できます（1チャンネル = 1アカウント）。",
        methodHeading: "認証方法",
        step1: "プロフィールページの［ストリーマーチャンネル所有権認証］セクションへ移動します。",
        step2: "認証したいプラットフォームの［チャンネル所有権認証］ボタンをクリックします。",
        step3: "該当プラットフォームの公式ログイン画面でご本人のアカウントでログイン・承認します。",
        step4: "OwOGGに戻ると、チャンネル情報が自動的に確認され表示されます。",
        calloutLoginStrong: "OwOGGへのログインとチャンネル認証は別物です。",
        calloutLoginBody:
          " Googleでログインしたからといって自動的にYouTubeチャンネルが連携されるわけではありません — 明示的な認証手続きが必要です。",
        calloutDuplicate:
          "1つの外部チャンネルは1つのOwOGGアカウントにのみ連携できます。すでに他のユーザーが認証したチャンネルを再度認証することはできません。",
        footerPrefix: "ストリーマーランキングに掲載されるには、上記4つのうち",
        footerStrong: "1つだけ",
        footerMid: "認証すれば十分です。詳しい資格条件は",
        footerLink: "ランキングのドキュメント",
        footerSuffix: "をご覧ください。",
      },
      streamerFeatured: {
        title: "Featured Streamer",
        description:
          "FeaturedはOwOGG基準の公開チャンネル指標で審査する、表示・フィルタリング専用のバッジです。",
        conceptHeading: "概念の区別",
        conceptStreamerTerm: "Streamer",
        conceptStreamerDesc: " — 公式OAuth/APIでチャンネル所有権が検証された状態。",
        conceptFeaturedTerm: "Featured Streamer",
        conceptFeaturedDesc:
          " — Streamerのうち、OwOGG基準（登録者・フォロワー数、チャンネル開設期間などの公開指標）を満たし自動・手動審査を通過した状態。",
        reviewHeading: "審査方式",
        reviewBody:
          "チャンネル所有権の認証直後にFeaturedが即時付与されることはありません。一定時間後に新しい公式指標で自動再審査が行われ、指標が曖昧な場合やプラットフォームが公式APIで指標を提供していない場合は、運営による手動審査へ安全に回されます。Featured認定後も定期的に再検証します。",
        calloutNoRankImpactStrong: "Featuredはスコア・XP・ランキング順位に影響しません。",
        calloutNoRankImpactBody:
          " 表示専用のバッジであり、Featuredの有無に関わらずストリーマーランキングはチャンネル所有権の認証のみで掲載されます。",
        calloutTestingPhase:
          "現在はサービス検証段階のためFeaturedは自動付与されず、チャンネル所有権が認証されたすべてのStreamerが運営の手動審査待ち状態を経ます。ストリーマーランキングにはFeaturedの有無に関わらず同様に掲載され、Featuredバッジもまだ公開表示していません。",
        footerNote:
          "運営の審査基準と手順は内部運用ドキュメントとして別途管理され、具体的な数値は公開していません — 審査には常に公式APIで確認可能な指標のみを使用します。",
      },
      account: {
        title: "アカウント概要",
        description:
          "OwOGGはGoogleとDiscordのログインに対応しており、2つは基本的に別々のアカウントです。",
        loginHeading: "ログイン方法",
        loginBody:
          "GoogleまたはDiscordでログインできます。同じ方であっても、Googleで作成したアカウントとDiscordで作成したアカウントは基本的に別のOwOGGアカウントです — 自動的に統合されることはありません。",
        profileHeading: "プロフィール設定",
        profileBody:
          "プロフィールページでニックネームと国・地域を設定でき、レベル・XP・実績・お気に入り・最近プレイした記録を確認できます。",
        profileLink: "プロフィールへ移動 →",
        calloutPrefix: "GoogleとDiscordのアカウントを別々に作成した場合は、",
        calloutLink: "アカウント統合",
        calloutSuffix: "機能で1つにまとめられます。",
      },
      accountMerge: {
        title: "アカウント統合",
        description:
          "Primary Account Wins方式 — 残すアカウント（Primary）を先に選んでから進めます。",
        howHeading: "統合方式: Primary Account Wins",
        howBodyPrefix: "2つのアカウントのうち、使い続ける方を",
        howBodyPrimary: "Primary",
        howBodySuffix:
          "に指定します。統合が完了すると、Primaryのゲーム記録・XP・パーソナライズ設定はそのまま維持され、Secondaryの該当データは統合されずに整理されます。Secondaryに紐づいていたGoogle/Discordのログイン手段のみがPrimaryへ移り、以降はどちらの手段でログインしても同じPrimaryアカウントに入ります。",
        stepsHeading: "手順",
        step1: "使い続けるアカウント（Primary）でログインします。",
        step2: "アカウント統合を開始し、統合対象のアカウント（Secondary）で本人確認を行います。",
        step3: "統合内容を確認します — Secondaryのゲーム・パーソナライズデータは維持されません。",
        step4: "確認後、統合を確定します。",
        step5: "以降はSecondaryだったログイン手段でもPrimaryアカウントにログインできます。",
        calloutNoMergeStrong: "記録は統合されません。",
        calloutNoMergeBody:
          " Primaryのスコア・XP・進行度のみが維持され、Secondaryの記録は統合後に失われます — 必ず残したいアカウントをPrimaryとして選択してください。",
        calloutAdminStrong: "Secondaryが管理者アカウントの場合、統合はブロックされます。",
        calloutAdminBody:
          " 管理者権限を持つアカウントをSecondaryとして統合すると、その権限がどこにも移らずに失われる可能性があるため、OwOGGは安全のためこの場合の統合自体を防ぎ、運営による個別対応を必要とします。",
        footerPrefix:
          "プラットフォーム所有権認証（Streamer）済みのアカウントを統合する場合のルールは、",
        footerLink: "Streamerチャンネル所有権認証",
        footerSuffix: "のドキュメントをご覧ください。",
      },
      games: {
        title: "ゲームとランキングの概要",
        description:
          "OwOGGは反応速度、順序記憶、エイム、タイピング速度などのミニゲームカタログを提供します。",
        intro:
          "各ゲームは独立したルールとスコア方式を持ち、有効な記録は自動的にランキングへ反映されます。プレイとは別に、活動そのものも経験値（XP）として蓄積されます。",
        cardRanking: "ランキング →",
        cardRankingDesc: "ゲーム別・ストリーマーランキングの計算方式",
        cardXp: "XPとレベル →",
        cardXpDesc: "経験値の付与方式とレベル計算式",
        cardDevelopment: "게임 개발 및 등록 →",
        cardDevelopmentDesc: "게임 크리에이터가 되어 직접 게임을 올리는 방법",
        footerPrefix: "今すぐ",
        footerLink: "ゲームカタログ",
        footerSuffix: "からプレイしてみましょう。",
      },
      gamesDevelopment: {
        title: "게임 개발 및 등록",
        description: "누구나 만든 웹 게임을 게임 크리에이터로 OwOGG에 올릴 수 있습니다.",
        intro:
          "웹으로 빌드되는 것이면 장르 제약 없이 올릴 수 있습니다 — 슈터, 퍼즐, 캐주얼, 액션, 무엇이든 좋습니다. 유일한 조건은 결과물이 index.html을 진입점으로 갖는 정적 웹 파일 묶음이어야 한다는 것입니다.",
        eligibilityHeading: "게임 크리에이터 자격 얻기",
        eligibilityBody:
          "게임을 업로드하려면 먼저 게임 크리에이터 자격이 필요합니다. 운영팀이 직접 임명하는 방식으로 운영되고 있으며, 셀프서비스 신청 기능은 현재 준비 중입니다(추후 업데이트 예정). 자격이 필요하면 운영팀에 문의해주세요.",
        eligibilityLink: "게임 크리에이터 센터 확인하기",
        sdkHeading: "호스트 연동 — 2줄이면 충분",
        sdkBody:
          "게임이 OwOGG 호스트에게 알려야 할 건 '로딩 끝남'과 '게임 종료 + 점수' 두 가지뿐입니다.",
        limitsHeading: "용량 제한",
        limitBundle: "ZIP 1개당 최대 20MiB (업로드 시점 압축 크기 기준)",
        limitExtracted: "압축을 풀었을 때 총 50MiB 이하",
        limitFiles: "파일 개수 300개 이하",
        flowHeading: "제출 → 심사 → 공개",
        flowStep1:
          "업로드: 게임 크리에이터 센터에서 owogg.json이 포함된 ZIP을 끌어다 놓으면 게임 등록과 업로드가 한 번에 끝납니다. 업로드 직후는 본인에게만 보입니다.",
        flowStep2:
          "심사: 운영팀이 실제로 플레이해보고 콘텐츠를 확인합니다. 승인되어도 자동으로 공개되지 않습니다.",
        flowStep3:
          "공개: 운영팀이 별도로 공개 전환해야 그 순간부터 실제 유저에게 서비스가 시작됩니다.",
        policyHeading: "콘텐츠 정책",
        policyBody:
          "불법 콘텐츠, 혐오/차별 표현, 성인 콘텐츠, 타인의 IP를 침해하는 에셋/텍스트, 악성 코드나 다른 유저에게 피해를 주는 로직은 금지됩니다.",
        footerPrefix: "자세한 업로드 절차는 ",
        footerLink: "게임 크리에이터 센터",
        footerSuffix: "에서 직접 확인하세요.",
      },
      gamesRanking: {
        title: "ランキング",
        description:
          "殿堂（/ranking）は、通常ランキングとストリーマーランキングを同じUIで提供します。各範囲でゲーム記録、XP、連続ログインを選択できます。",
        gameHeading: "通常ランキング",
        gameBody:
          "ゲーム記録とXPはKST基準の日間・週間・月間に分かれます。ゲーム記録は選択期間内のユーザーごとの自己ベスト1件、連続ログインは現在有効な日数を表示します。",
        xpHeading: "期間・達成日",
        xpBodyPrefix: "各行に順位値を達成した年月日を表示します。XPの付与方式は",
        xpBodyLink: "XPとレベルのドキュメント",
        xpBodySuffix: "をご覧ください。",
        streamerHeading: "ストリーマーランキング",
        streamerBodyPrefix: "YouTube / CHZZK / SOOP / Twitch のうち",
        streamerBodyStrong: "1つ以上",
        streamerBodySuffix:
          "のプラットフォームで公式チャンネル所有権認証を完了したユーザーのみが表示されます。ゲーム記録・XP・連続ログインは通常ランキングと同じ計算式とUIを使い、認証数は順位に影響しません。",
        streamerLinkPrefix: "詳しい認証方法は",
        streamerLink: "Streamerチャンネル所有権認証",
        streamerLinkSuffix: "のドキュメントをご覧ください。",
        calloutFeatured:
          "Featured Streamerの表示は、ランキング順位やXP計算に一切影響しない表示専用のバッジです。",
        footerPrefix: "Discordサーバー単位のランキングは",
        footerLink: "DiscordサーバーXPのドキュメント",
        footerSuffix: "をご覧ください。",
      },
      gamesXp: {
        title: "XPとレベル",
        description:
          "ゲームを有効に完了するたびに経験値が貯まり、累計経験値に応じてレベルが上がります。",
        grantHeading: "XPの付与",
        grantPerPlay: "認められたゲーム完了1回につき10 XPが付与されます。",
        grantDailyCap: "同じゲームは1日（UTC基準）最大10回までXPが付与されます。",
        grantAfterCap:
          "上限に達してもゲームのプレイ自体は続けられます — 追加のXPが付与されなくなるだけです。",
        formulaHeading: "レベル計算式",
        formulaPrefix: "レベルLに到達するために必要な累計XPは",
        formulaSuffix: "です。レベルが上がるほど、次のレベルまでに必要なXPは増えていきます。",
        calloutPrefix: "DiscordサーバーでのXPとグローバルXPの関係が気になる方は",
        calloutLink: "DiscordサーバーXPのドキュメント",
        calloutSuffix: "をご確認ください。",
        footerPrefix: "自分のレベルとXPは",
        footerProfileLink: "プロフィール",
        footerMid: "で、全体の順位は",
        footerRankingLink: "殿堂",
        footerSuffix: "で確認できます。",
      },
      gettingStarted: {
        title: "はじめる",
        description: "最速で最初のゲームをプレイし、記録を残すための手順です。",
        flowHeading: "基本の流れ",
        step1: "OwOGGアカウントでログインします（GoogleまたはDiscord）。",
        step2: "ゲームカタログから好きなミニゲームを選びます。",
        step3: "ゲームをプレイして結果を確認します — 有効な記録は自動的に保存されます。",
        step4: "殿堂（ランキング）で自分の順位とXPを確認します。",
        step5: "必要であればDiscordを連携し、サーバーの友達と競い合います。",
        calloutGuest:
          "ゲストのままでもゲームをプレイできます。ただし記録がアカウントに保存され、ランキング・XPに反映されるにはログインが必要です。",
        cardCatalog: "ゲームカタログ →",
        cardCatalogDesc: "今すぐプレイするゲームを選ぶ",
        cardRanking: "殿堂 →",
        cardRankingDesc: "ゲーム・XP・ストリーマーランキングを確認",
        footerPrefix: "Discordサーバーで友達と一緒に遊びたい場合は",
        footerDiscordLink: "Discordのドキュメント",
        footerMid: "を、アカウント設定は",
        footerAccountLink: "アカウントのドキュメント",
        footerSuffix: "をご確認ください。",
      },
      discordOverview: {
        title: "Discord概要",
        description:
          "OwOGGは常時接続のBotではなく、署名付きHTTP Interactionsで動作します。インストール・アカウント連携・サーバー登録は別々の3ステップです。",
        calloutStrong:
          "一般ユーザーがBot Token、Application ID、Public Keyを扱う必要はありません。",
        calloutBody: " これらの値はOwOGG運営のみがGitHub Actions Secretとして管理します。",
        flowHeading: "全体の流れ",
        step1: "DiscordにOwOGGアプリを追加します（サーバー管理者権限が必要）。",
        step2: "選択したサーバーを確認して承認します。",
        step3: "OwOGGに戻ってDiscordアカウントを連携します。",
        step4: "管理権限のあるサーバーをOwOGGコミュニティとして登録します。",
        step5: "Discordで /owogg games、/owogg play から始めます。",
        cardInstall: "インストール →",
        cardInstallDesc: "サーバーにアプリを追加する方法",
        cardServerReg: "サーバー登録 →",
        cardServerRegDesc: "PUBLIC/UNLISTED/PRIVATEを選択",
        cardCommands: "コマンド →",
        cardCommandsDesc: "/owogg の全サブコマンド",
        cardTroubleshooting: "トラブルシューティング →",
        cardTroubleshootingDesc: "症状別の解決方法",
        footerPrefix: "今すぐインストールを始めるなら",
        footerLink: "5ステップ インストールガイド",
        footerSuffix: "をご利用ください。",
      },
      discordInstall: {
        title: "DiscordにOwOGGをインストールする",
        description:
          "Discordアプリのインストールは、サーバーでOwOGGを使うための準備段階です。サーバー登録とは別のものです。",
        calloutStrong: "一般ユーザーがBot Tokenを入力する必要はありません。",
        calloutBody:
          " 以下の公式インストールリンクをクリックし、Discordのサーバー選択・承認画面に従うだけです。",
        checklistPrefix:
          "インストールからアカウント連携、サーバー登録までの進捗をリアルタイムで確認するには",
        checklistLink: "5ステップセットアップガイド",
        checklistSuffix: "をご利用ください。",
        buttonLabel: "DiscordにOwOGGを追加",
        loadingPrefix: "インストールリンクを読み込み中か、まだ準備ができていません。",
        loadingLink: "インストールガイド",
        loadingSuffix: "で改めてご確認ください。",
        calloutWarningStrong: "アプリのインストール ≠ OwOGGサーバー登録です。",
        calloutWarningBodyPrefix:
          " アプリをインストールしても、サーバーが自動的にOwOGGディレクトリに公開されるわけではありません。管理者が別途",
        calloutWarningLink: "サーバー登録",
        calloutWarningSuffix: "を完了する必要があります。",
        footerPrefix: "インストール後の次のステップは",
        footerLink: "アカウント連携",
        footerSuffix: "です。",
      },
      discordAccountLink: {
        title: "アカウント連携",
        description:
          "DiscordアカウントをOwOGGアカウントと連携すると、Botコマンド（/owogg profile、/owogg playなど）で自分の情報を利用できます。",
        methodHeading: "連携方法",
        step1: "Discordサーバーで /owogg link コマンドを入力します。",
        step2: "Botが自分にだけ見える（ephemeral）ワンタイム連携リンクを返します。",
        step3: "そのリンクをクリックしてOwOGGウェブに移動します。",
        step4: "OwOGGにログインしていない場合は先にログインします。",
        step5: "連携確認画面で承認すれば完了です。",
        calloutPrefix:
          "連携リンクはワンタイムで、一定時間後に失効します。失効した、またはすでに使用済みのリンクの場合は、Discordで",
        calloutCode: "/owogg link",
        calloutSuffix: "を再実行して新しいリンクを取得してください。",
        calloutWarning:
          "1つのDiscordアカウントは、最初に登録した1つのOwOGGアカウントにのみ紐づきます。連携を解除しても登録上の所有権は維持され、別のアカウントへ移すことはできません。",
        footerPrefix: "連携に失敗しますか？",
        footerLink1: "トラブルシューティングガイド",
        footerMid: "をご確認ください。または、ウェブから直接",
        footerLink2: "アカウント連携ページ",
        footerSuffix: "を開くこともできます。",
      },
      discordServerRegistration: {
        title: "サーバー登録",
        description:
          "アプリのインストールとサーバー登録は別のものです。サーバー登録を完了すると、サーバーXP・リーダーボード・サーバー専用ページが有効になります。",
        requirementsHeading: "登録要件",
        req1: "OwOGGアカウントでログインしている必要があります。",
        req2: "登録するDiscordサーバーでサーバー管理（Manage Server）権限が必要です。",
        req3: "OwOGGアプリがそのサーバーにすでにインストールされている必要があります。",
        stepsHeading: "登録手順",
        step1: "OwOGGにログインした状態でDiscordサーバー登録の認証を開始します。",
        step2: "Discordが要求する権限（サーバー一覧の確認）を承認します。",
        step3: "管理可能なサーバー一覧から登録するサーバーを選択します。",
        step4: "サーバーのslug（URL名）と紹介文、公開範囲を設定します。",
        step5: "登録が完了すると、サーバー専用ページが即座に作成されます。",
        buttonLabel: "サーバー登録を始める",
        visibilityHeading: "公開範囲（Visibility）",
        visibilityPublicDesc: "OwOGGサーバーディレクトリと検索に表示されます。",
        visibilityUnlistedDesc:
          "直接リンクからのみアクセス可能で、ディレクトリには表示されません。",
        visibilityPrivateDesc: "サーバー管理者のみアクセス可能です。",
        calloutStrong: "アプリのインストール ≠ サーバー登録。",
        calloutBody:
          " アプリをインストールしただけではサーバーが自動的に公開されません。必ず上記の手順で直接登録してください。",
        footerPrefix: "サーバーが一覧にない場合は",
        footerLink: "トラブルシューティングガイド",
        footerSuffix: "の「サーバーが登録候補にありません」の項目をご確認ください。",
      },
      discordCommands: {
        title: "コマンド",
        description: "OwOGGのDiscordコマンドはすべて /owogg のサブコマンドです。",
        calloutEphemeral:
          "表示される応答は、コマンドを実行したユーザーにのみ見える一時的（ephemeral）なメッセージです — チャンネルの他のユーザーには表示されません。",
        labelWhere: "使用できる場所",
        labelAccountLink: "アカウント連携が必要",
        labelGuildRequired: "サーバー登録が必要",
        labelArgs: "引数",
        labelExample: "例",
        labelCommonError: "よくあるエラー: ",
        yes: "はい",
        no: "いいえ",
        footerPrefix: "想定と違う動作をしますか？",
        footerLink: "トラブルシューティングガイド",
        footerSuffix: "をご確認ください。",
        commands: [
          {
            purpose: "このDiscordアカウントをOwOGGアカウントと連携します。",
            where: "サーバーチャンネルまたはDM",
            args: "なし",
            commonError: "すでに連携済みの場合、新しいリンクの代わりに案内メッセージのみ届きます。",
          },
          {
            purpose: "連携済みOwOGGアカウントのニックネーム、レベル、合計XPを確認します。",
            where: "サーバーチャンネルまたはDM",
            args: "なし",
            commonError: "アカウントが連携されていない場合、/owogg link の案内が届きます。",
          },
          {
            purpose: "現在OwOGGでプレイ可能なゲームの一覧とリンクを確認します。",
            where: "サーバーチャンネルまたはDM、ログイン不要",
            args: "なし",
            commonError: "なし（常に公開で応答します）",
          },
          {
            purpose: "このサーバーにXPが帰属するワンタイムのゲームプレイリンクを発行します。",
            where: "登録済みサーバーチャンネル",
            args: "game（任意）— 特定のゲームを指定、省略するとゲーム一覧に移動",
            commonError:
              "サーバーが未登録またはアカウントが未連携の場合、案内メッセージが届きます。リンクは15分間、1回のみ有効です。",
          },
          {
            purpose: "このサーバー内での自分の順位とサーバー貢献XPを確認します。",
            where: "登録済みサーバーチャンネル",
            args: "なし",
            commonError:
              "アカウント未連携、またはこのサーバーでまだ活動がない場合、案内メッセージが届きます。",
          },
          {
            purpose: "このサーバーのOwOGG XPリーダーボードTop 10を確認します。",
            where: "登録済みサーバーチャンネル",
            args: "なし",
            commonError: "サーバーが未登録の場合、案内メッセージが届きます。",
          },
          {
            purpose: "このサーバーの合計XPと週間活動サマリーを確認します。",
            where: "登録済みサーバーチャンネル",
            args: "なし",
            commonError: "サーバーが未登録の場合、案内メッセージが届きます。",
          },
        ],
      },
      discordXp: {
        title: "サーバーXPの計算方法",
        description:
          "グローバルXP、サーバー別ユーザーXP、サーバー活動XPは、それぞれ異なる3つの数値です。",
        differHeading: "3種類のXPは異なります",
        globalTerm: "通常のOwOGG XP（グローバル）",
        globalDesc: " — アカウント全体の累積経験値。プロフィール・全体ランキングに使用されます。",
        perGuildTerm: "Discordサーバー別ユーザーXP",
        perGuildDescPrefix: " — そのサーバーで",
        perGuildDescCode: "/owogg play",
        perGuildDescSuffix: "によって作られた有効な完了のみが累積されます。",
        guildActivityTerm: "Discordサーバー活動XP",
        guildActivityDesc:
          " — サーバーメンバー全員が貢献した合計で、サーバーリーダーボード・週間ランキングに使用されます。",
        exampleHeading: "例",
        exampleBodyPrefix: "グローバルXPが25,000のユーザーが、新しく登録されたGuild Aで",
        exampleBodyCode: "/owogg play",
        exampleBodySuffix: "によって有効な完了を1回（+10）作った場合:",
        cardGlobalTitle: "グローバルXP",
        cardGlobalText: "アカウント全体の累積",
        cardGuildATitle: "Guild AユーザーXP",
        cardGuildAText: "Aで作られた有効な貢献",
        cardGuildBTitle: "Guild B",
        cardGuildBText: "既存のXPは自動的にコピーされません",
        calloutNoCopyStrong: "既存のグローバルXPは新しいサーバーに自動的にコピーされません。",
        calloutNoCopyBody:
          " 新しく登録されたサーバーは常に0から始まり、そのサーバーで新たに作られた有効なプレイのみが蓄積されます。",
        calloutAbuseStrong: "不正防止:",
        calloutAbuseBody:
          " ユーザー × ゲーム × UTC1日あたりのグローバルXP付与は最大10回です。上限に達してもゲームの完了自体は引き続き可能ですが、追加のXPは付与されません。1つのプレイイベントは最大1つのサーバーにのみ帰属します — 同じ完了が複数のサーバーで重複してXPを作ることはありません。",
        footerPrefix: "サーバーランキングの見方は",
        footerLink: "ゲームとランキングのドキュメント",
        footerSuffix: "をご参照ください。",
      },
      discordTroubleshooting: {
        title: "トラブルシューティング",
        description:
          "症状から探してください。いずれの場合も、一般ユーザーがBot Tokenを設定する必要はありません。",
        calloutWarning:
          "以下のどの症状も、Bot Token、Application ID、Public Keyの入力を求めることはありません。そのような案内を受けた場合、公式のOwOGGチャンネルではない可能性があります。",
        faqAutocomplete: {
          question: "/owoggがオートコンプリートに表示されません",
          answerPrefix:
            "Discordクライアントを再起動するか、サーバーを一度抜けて再度参加してみてください。それでも表示されない場合、アプリが実際にこのサーバーにインストールされているかサーバー管理者に確認を依頼してください。OwOGG運営側では",
          answerCode: "pnpm discord:commands:check",
          answerSuffix: "でグローバルコマンドの登録状況を確認できます。",
        },
        faqPlainMessage: {
          question: "/owogg link と入力したら通常のメッセージとして送信されました",
          answer:
            "正常なスラッシュコマンドではなく通常のテキストとして送信された場合、Discordがコマンドとして認識していません。オートコンプリート一覧から正確に /owogg を選択し、サブコマンドを選んで実行する必要があります。直接タイプして送信すると通常のメッセージになります。",
        },
        faqNoResponse: {
          question: "アプリケーションが応答しませんでした",
          answer:
            "一時的な遅延やエラーの可能性があります。しばらくしてから再度お試しください。繰り返し発生する場合、OwOGGのサービス状態に問題がある可能性がありますので、しばらくしてから改めてご確認ください。",
        },
        faqAlreadyLinked: {
          question: "アカウントがすでに連携されていると表示されます",
          answer:
            "このDiscordアカウントはすでに別のOwOGGアカウントに登録されています。最初に登録したOwOGGアカウントへの紐づきは連携解除後も維持され、別のアカウントへ再登録することはできません。",
        },
        faqServerNotRegistered: {
          question: "/owogg play でサーバーが未登録と表示されます",
          answerPrefix:
            "このDiscordサーバーはまだOwOGGコミュニティとして登録されていません。サーバー管理者が",
          answerLink: "サーバー登録",
          answerSuffix: "を完了する必要があります。アプリのインストールだけでは登録されません。",
        },
        faqNotInCandidateList: {
          question: "サーバーが登録一覧（登録候補）にありません",
          answer:
            "登録可能なサーバー一覧には、実際にサーバー管理（Manage Server）権限があるサーバーのみが表示されます。権限がない、またはログインしているDiscordアカウントが希望のサーバーのものか確認してください。",
        },
        faqBotNotVisible: {
          question: "BotがDiscordのメンバー一覧に表示されません",
          answer:
            "OwOGGは常時接続（Gateway）Botではなく、署名付きHTTP Interactions方式で動作します。そのため、メンバー一覧に常に「オンライン」として表示されない場合があります — これは正常であり、コマンドの動作には影響しません。",
        },
        faqBotOffline: {
          question: "Botがオフラインに見えます",
          answer:
            "上記と同じ理由です。HTTP Interactionsベースのアプリは常時接続状態を維持しないため、Discordのメンバー一覧でオフラインと表示されることがあります。コマンドが正常に実行される場合は問題ありません。",
        },
        footerPrefix: "ここにない問題ですか？",
        footerLink: "Discord利用ガイド",
        footerSuffix: "のFAQもご確認ください。",
      },
      support: {
        title: "お問い合わせ・通報・不具合報告",
        description: "内容に合ったチャンネルにご連絡いただくと、より早く対応できます。",
        generalHeading: "一般のお問い合わせ (contact@owogg.com)",
        generalBody: "アカウントの問題、使い方、機能のご提案など、その他すべてのお問い合わせ。",
        reportHeading: "通報 (report@owogg.com)",
        reportBody:
          "不正行為、迷惑行為、不適切なコンテンツなど、コミュニティガイドライン違反の通報。",
        bugHeading: "不具合報告 (bug@owogg.com)",
        bugBody:
          "ゲームのエラー、機能不具合、表示崩れなど技術的な問題。どのゲーム/ページで、どんな状況で発生したかを教えていただけると、確認が早くなります。",
        tipsHeading: "共通のヒント",
        tip1: "可能であればスクリーンショットを添付してください。",
        tip2: "アカウントに関するお問い合わせは、登録時のメールアドレスまたはニックネームを添えてください。",
        tip3: "通報の場合は、対象(ニックネーム/投稿など)と具体的な状況を添えてください。",
        footerPrefix: "3つのチャンネルをまとめて確認し、すぐにメールを送るには",
        footerLink: "お問い合わせページ",
        footerSuffix: "をご利用ください。",
      },
    },
    legal: {
      terms: {
        metaTitle: "利用規約",
        metaDescription: "OwOGG サービス利用規約",
        pageTitle: "利用規約",
        effectiveDate: "施行日: 2026年8月14日",
        section1Heading: "1. サービスの概要",
        section1Body:
          "OwOGG（以下「サービス」）は、インストール不要でブラウザから直接楽しめるウェブミニゲーム集プラットフォームであり、Discordサーバー連携、ランキング/経験値（XP）、Streamerチャンネル認証などの付加機能を併せて提供します。",
        section2Heading: "2. アカウントおよびログイン",
        section2Body:
          "本サービスはGoogleまたはDiscordアカウントによるOAuthログインのみをサポートし、別途のID/パスワードを直接発行しません（管理者専用アカウントを除く）。利用者はご自身が所有するアカウントでのみログインする必要があり、アカウント管理に関する責任は利用者ご自身にあります。",
        section3Heading: "3. 利用者の義務",
        section3Intro: "利用者は以下の行為を行ってはなりません。",
        section3List: [
          "自動化ツールやマクロなどを利用してゲームの記録や経験値を不正に操作する行為",
          "ご自身が所有していないアカウント、チャンネル、Discordサーバーをあたかもご自身の所有であるかのように登録・認証する行為",
          "他人の個人情報を無断で収集・掲載したり、サービスを通じて他人に被害を与える行為",
          "サービスの正常な運営を妨害する攻撃、過度なリクエスト、脆弱性の悪用行為",
        ],
        section4Heading: "4. コンテンツおよびゲーム記録",
        section4Body:
          "利用者が作成したゲーム記録、ニックネーム、プロフィール情報はランキング/XPなどのサービス提供目的で使用されます。本サービスは不正な記録と判断されるデータを事前の通知なく調整または削除することがあります。",
        section5Heading: "5. サービスの変更および中断",
        section5Body:
          "本サービスは運営上・技術上の必要に応じて、提供するゲーム、機能、画面構成を予告なく変更または中断することがあります。本サービスは無料で提供され、可用性や特定のパフォーマンスを保証するものではありません。",
        section6Heading: "6. 免責事項",
        section6Body:
          "本サービスは無料で提供される個人/小規模プロジェクトであり、関連法令が許容する範囲においてサービス利用に関して発生する損害について責任を負いません。ただし、故意または重過失による損害は例外とします。",
        section7Heading: "7. 規約の変更",
        section7Body:
          "本規約は必要に応じて改定されることがあり、改定時には本ページを通じて告知します。改定された規約は掲示と同時に効力を発生します。",
        section8Heading: "8. お問い合わせ",
        section8BodyPrefix: "サービス利用に関するお問い合わせは ",
        section8BodyEmail: "contact@owogg.com",
        section8BodySuffix: " までご連絡ください。",
      },
      privacy: {
        metaTitle: "プライバシーポリシー",
        metaDescription: "OwOGG プライバシーポリシー",
        pageTitle: "プライバシーポリシー",
        effectiveDate: "施行日: 2026年8月14日",
        section1Heading: "1. 収集する個人情報の項目",
        section1Intro: "OwOGGはサービス提供のため、以下の情報のみを収集します。",
        section1List: [
          {
            term: "ログイン情報",
            desc: " — GoogleまたはDiscordアカウントでのログイン時に提供されるメールアドレス、ニックネーム（表示名）、プロフィール写真URL、アカウント固有識別子（sub/ID）",
          },
          {
            term: "ゲーム利用記録",
            desc: " — ゲーム別のスコア/記録、経験値（XP）、レベル、実績達成履歴",
          },
          {
            term: "プロフィール設定",
            desc: " — 利用者が直接入力するニックネーム、国/地域（任意、自己申告情報であり国籍認証ではありません）",
          },
          {
            term: "Discord連携情報",
            desc: " — アカウント連携時のDiscordユーザーID、サーバー（ギルド）登録時のサーバーID/名前/アイコン、管理権限の有無",
          },
          {
            term: "Streamerチャンネル認証情報",
            desc: " — ストリーマーランキング参加のために自主的にチャンネル所有権認証を行った場合、該当プラットフォーム（YouTube/Twitch/CHZZK/SOOP）の公式APIを通じて確認されたチャンネル名、チャンネルURL、チャンネル登録者/フォロワー数",
          },
        ],
        section1Outro:
          "パスワードは別途収集しません（管理者専用アカウントは例外であり、該当パスワードはPBKDF2でハッシュ化して保存され、平文で保管されません）。",
        section2Heading: "2. 収集目的",
        section2List: [
          "会員識別およびログイン状態の維持",
          "ゲーム記録・ランキング・経験値システムの提供",
          "Discordボットコマンドでのご自身のアカウント情報照会、サーバー別活動集計",
          "Streamer/ストリーマーランキング資格の確認",
          "不正利用（アビューズ）の検知およびサービスの安定性維持",
        ],
        section3Heading: "3. 保管期間",
        section3Body:
          "個人情報は会員退会時または利用者の削除要請時まで保管し、関連法令で別途保管が義務付けられている場合はそれに従います。",
        section4Heading: "4. 第三者への提供",
        section4Body:
          "OwOGGは利用者の個人情報を広告、マーケティング等の目的で第三者に提供または販売しません。サービス運営に必要なインフラ（Cloudflare — サーバー/データベースホスティング）のみを利用しており、これは第三者へのマーケティング提供には該当しません。",
        section5Heading: "5. 利用者の権利",
        section5Body:
          "利用者はいつでもご自身の個人情報の閲覧、訂正、削除（アカウント退会）を要請できます。以下のお問い合わせ先にご連絡いただければ、確認の上処理いたします。",
        section6Heading: "6. クッキーおよびセッション",
        section6Body:
          "ログイン状態維持のためにセッションクッキーを使用します。広告目的のトラッキングクッキーや第三者の分析ツールは使用しません。",
        section7Heading: "7. お問い合わせ",
        section7BodyPrefix: "個人情報に関するお問い合わせは ",
        section7BodyEmail: "contact@owogg.com",
        section7BodySuffix: " までご連絡ください。",
      },
    },
    gamePlay: {
      errorGameNotFound: "ゲームが見つかりません。",
      gameDisabledTitle: "現在利用できないゲームです",
      gameDisabledBody:
        "運営者により一時的に無効化されています。しばらくしてから再度お試しください。",
      errorLoadFailed: "ゲームの読み込み中にエラーが発生しました。",
      errorSubmitFailed: "スコアの保存に失敗しました。",
      errorNetworkSubmitFailed: "ネットワークエラーによりスコアを保存できませんでした。",
      errorSubmitFallback: "記録の保存に失敗しました",
      backToList: "リストに戻る",
      back: "戻る",
      loadingTitle: "ゲームを読み込み中...",
      loadingBody: "ゲームを読み込んでいます...",
      authRequiredTitle: "ログインが必要なゲームです",
      authRequiredBody:
        "このミニゲームはアカウントにログイン後、プレイとランキング登録が可能です。",
      authRequiredCta: "ログインしてプレイする",
      resultTitle: "ゲーム終了！",
      finalScoreLabel: "最終スコア",
      deviceBestLabel: "端末のベスト記録",
      metadataWpm: "速度（WPM）",
      metadataCpm: "打鍵数（CPM）",
      metadataAccuracy: "正確性",
      metadataCorrectChars: "正打数",
      metadataIncorrectChars: "誤打数",
      metadataTotalTypedChars: "総入力数",
      metadataDurationMs: "所要時間（ms）",
      metadataTargetsHit: "命中ターゲット",
      metadataMisses: "失敗ターゲット",
      metadataLevel: "到達レベル",
      metadataTargets: "ターゲット数",
      metadataAvgPerTargetMs: "ターゲット毎の平均（ms）",
      metadataSequenceLength: "パターンの長さ",
      metadataGrade: "評価",
      metadataAuthoritativeRawScore: "検証済み元スコア",
      guestNoticeTitle: "ゲストの記録はこの端末にのみ保存されます。",
      guestNoticeBody: "ログインすると、次回のプレイからランキングに参加できます。",
      guestLoginCta: "ログイン",
      submittingLabel: "ランキングにスコアを登録中...",
      successLabel: "記録がランキングに登録されました！",
      retrySubmitCta: "スコアを再送信",
      leaderboardYou: "自分",
      retryGameCta: "🔄 もう一度プレイ",
      returnToGameCta: "ゲーム画面に戻る",
      backToListResult: "リストに戻る",
      difficultyNormal: "ノーマル",
      difficultyHard: "ハード",
      shareText: "{title}で{score}を記録しました！挑戦してみて 🎮",
      shareXCta: "Xでシェア",
      shareDiscordCta: "Discord用にコピー",
      shareDiscordCopiedFeedback: "コピーしました！Discordに貼り付けてください",
      shareXScreenshotHint:
        "スクリーンショットをコピーしました！ツイート作成画面に貼り付け(Ctrl+V)てください",
      screenshotCopyCta: "スクリーンショットをコピー",
      screenshotCopiedFeedback: "画像をコピーしました！",
      screenshotDownloadedFeedback: "画像をダウンロードしました",
      screenshotErrorFeedback: "スクリーンショットの作成に失敗しました",
      leaderboardTitle: "リーダーボード",
      leaderboardEmpty: "まだ記録がありません。",
      viewFullRanking: "全体ランキングを見る →",
      fullscreenEnterCta: "全画面表示",
      fullscreenExitCta: "全画面表示を終了",
      fullscreenRecommendedHint: "おすすめ",
      mobileExperimentalNotice: "モバイル対応は実験的な機能です。",
      mobileUnsupportedNotice: "このゲームはモバイル環境に対応していない場合があります。",
      orientationPortraitHint: "このゲームは縦画面に最適化されています。",
      orientationLandscapeHint: "このゲームは横画面に最適化されています。",
      bookmarkCta: "ブックマーク",
      bookmarkedCta: "ブックマーク済み",
      shareGameCta: "共有",
      shareGameCopied: "リンクをコピーしました",
      feedbackCta: "フィードバック",
      mobilePlayCta: "モバイルでプレイ",
      theaterModeEnterCta: "シアターモード",
      theaterModeExitCta: "標準表示",
      adLabel: "広告",
      adPlaceholder: "コンテンツのレイアウトを安定させるための広告予約枠です。",
      recommendedGamesTitle: "次にプレイ",
      recommendedGamesEmpty: "おすすめできる他の公開ゲームはまだありません。",
      gameInfoTitle: "ゲーム情報",
      publisherLabel: "制作者",
      publishedLabel: "アップロード",
      playerStatsLabel: "プレイヤー",
      bookmarkStatsLabel: "ブックマーク",
      officialGameBadge: "公式ゲーム",
      userGameBadge: "ユーザー制作",
      mobilePlayTitle: "スマートフォンで続けてプレイ",
      mobilePlayBody:
        "下のリンクをコピーまたは共有し、モバイルブラウザで同じゲームを開いてください。",
      copyGameLinkCta: "ゲームリンクをコピー",
      closeDialogCta: "閉じる",
      gameLinkCopied: "ゲームリンクをコピーしました。",
    },
    gameRanking: {
      eyebrow: "ゲーム別ランキング",
      backToGame: "ゲームに戻る",
      notSupported: "このゲームはランキングに対応していません",
      notSupportedBody: "順位なしで楽しむカジュアルゲームです。",
    },
    userProfile: {
      eyebrow: "プレイヤープロフィール",
      backToHome: "ホームへ",
      notFoundTitle: "ユーザーが見つかりません",
      notFoundBody: "存在しない、または削除されたアカウントです。",
      loadErrorBody: "プロフィールを読み込めませんでした。",
      retryButton: "再試行",
      joinedPrefix: "登録日",
      levelLabel: "レベル",
      globalRankPrefix: "全体XPランキング #",
      streakLabel: "連続ログイン",
      streakDaysSuffix: "日目",
      longestStreakPrefix: "最高記録",
      achievementsTitle: "実績",
      achievementsEmpty: "まだ達成した実績がありません。",
      achievedSuffix: "達成",
      gameRecordsTitle: "ゲーム別ベスト記録",
      gameRecordsEmpty: "まだ記録がありません。",
      streamerBadgesTitle: "認証済みストリーマーチャンネル",
      manageProfileCta: "設定 →",
      favoritesTitle: "お気に入り",
      favoritesEmpty: "まだお気に入りのゲームがありません。",
      recentPlaysTitle: "最近のプレイ",
      recentPlaysEmpty: "まだプレイ記録がありません。",
      itemsCountSuffix: "件",
      onlyVisibleToYou: "自分のみ",
      settingsCta: "設定で変更",
    },
    registeredServers: {
      ariaLabel: "登録済みDiscordサーバー",
      title: "登録済みサーバー",
      empty: "まだ登録されたサーバーがありません。",
      viewAll: "すべてのサーバーを見る →",
    },
    changelog: {
      eyebrow: "Changelog",
      title: "更新履歴",
      subtitle: "OwOGGの変更点やお知らせをご確認ください。",
      emptyState: "まだ更新履歴がありません。",
      tagFeature: "新機能",
      tagImprovement: "改善",
      tagFix: "修正",
    },
    platformIcon: {
      chzzkLabel: "CHZZK",
      soopLabel: "SOOP",
      channelSuffix: "チャンネル",
      verifiedPlatforms: "認証済みプラットフォーム",
    },
    contact: {
      eyebrow: "お問い合わせ",
      title: "何かお困りですか?",
      subtitle: "内容に合ったチャンネルにお送りいただくと、より早く確認できます。",
      emailCta: "メールアドレスをコピー",
      emailCopiedFeedback: "コピーしました！",
      generalLabel: "一般のお問い合わせ",
      generalDesc: "アカウント、使い方、ご提案など",
      reportLabel: "通報",
      reportDesc: "不正行為、迷惑行為、不適切なコンテンツの通報",
      bugLabel: "不具合報告",
      bugDesc: "ゲームのエラーや機能不具合などの報告",
      guidanceTitle: "お問い合わせ前にご確認ください",
      guidanceItems: [
        "不具合報告の場合は、どのゲーム/ページで、どんな状況で発生したかを教えてください。",
        "可能であればスクリーンショットを添付していただけると大変助かります。",
        "アカウントに関するお問い合わせは、登録時のメールアドレスまたはニックネームを添えてください。",
        "通報の場合は、対象(ニックネーム/投稿など)と具体的な状況を添えてください。",
      ],
      discordAltTitle: "Discordでもお問い合わせいただけます",
      discordAltBody:
        "よりスピーディーなやり取りをご希望の場合は、コミュニティサーバーのDiscordガイドをご確認ください。",
      discordAltCta: "Discordガイドを見る",
    },
  },
  "zh-CN": {
    common: {
      loading: "加载中...",
      error: "出现问题。",
      retry: "重试",
      empty: "暂无内容。",
      save: "保存",
      cancel: "取消",
    },
    nav: {
      searchPlaceholder: "按游戏名称、标签或分类搜索...",
      favorites: "收藏",
      login: "登录",
      logout: "退出登录",
      myProfile: "个人资料",
      settings: "设置",
      ranking: "名人堂",
      wiki: "Wiki",
      accountSuffix: "账号",
    },
    sidebar: {
      openMenuAria: "打开菜单",
      expandMenuAria: "展开侧边栏",
      collapseMenuAria: "收起侧边栏",
      mobileMenuTitle: "菜单",
      home: "首页",
      allGames: "全部游戏",
      popularGames: "热门游戏",
      rankingRecords: "排行榜和记录",
      otherHeading: "其他",
      discordHub: "Discord",
      moreHeading: "更多",
      favorites: "收藏",
      discordServers: "已注册的 Discord 服务器",
    },
    footer: {
      tagline: "无需安装，一秒畅玩的小游戏",
      allGames: "全部游戏",
      ranking: "名人堂",
      wiki: "Wiki",
      changelog: "更新日志",
      contactUs: "联系我们",
      rightsReserved: "All rights reserved.",
    },
    home: {
      heroEyebrow: "无需安装，即刻畅玩",
      heroTitle: "告别无聊，好玩游戏尽在一处",
      heroSubtitle: "畅玩轻量网页小游戏，与好友一较高下。",
      browseGames: "浏览游戏",
      lineupTitle: "小游戏阵容",
      itemsCountSuffix: "个",
      popularTitle: "热门游戏",
      recentPlaysTitle: "最近游玩",
      favoritesTitle: "我的收藏",
      emptyCategory: "该分类下暂无游戏。",
      gridColumnsAriaPrefix: "以",
      gridColumnsAriaSuffix: "列显示",
      teaserTitle: "实时排行榜与多人模式即将上线",
      teaserBody: "即将推出多人模式，你和朋友只需一个链接即可加入，实时展开对决。",
      teaserCta: "预览游戏",
    },
    language: { label: "语言", ko: "한국어", en: "English", ja: "日本語", zh: "简体中文" },
    loginModal: {
      title: "登录 OwOGG",
      subtitle: "选择一个社交账号即可安全登录。",
      close: "关闭",
      googleButton: "使用 Google 账号登录",
      googleLoading: "正在使用 Google 登录...",
      googleUnconfigured: "Google 登录尚未配置。",
      discordButton: "使用 Discord 账号登录",
      discordLoading: "正在使用 Discord 登录...",
      discordUnconfigured: "Discord 登录尚未配置。",
      providerChecking: "正在检查登录服务器配置。",
      providerUnavailable: "暂时无法连接登录服务器。",
      retry: "重试",
    },
    games: {
      eyebrow: "Game Collection",
      title: "全部小游戏",
      countSuffix: "款轻量小游戏已就绪。",
      searchPlaceholder: "搜索游戏...",
      emptyFavorites: "还没有收藏的游戏。",
      emptySearch: "没有匹配的游戏。",
      sortLabel: "游戏排序",
      sortOptions: {
        popular: "热门排序",
        newest: "发布时间",
        players: "浏览量",
        bookmarks: "收藏量",
      },
      playerCountLabel: "游玩用户",
      bookmarkCountLabel: "收藏用户",
      categories: {
        all: "全部",
        popular: "热门",
        reaction: "反应力",
        brain: "益智",
        aim: "瞄准",
        typing: "打字",
        favorites: "收藏",
      },
      addFavoriteAriaPrefix: "将",
      addFavoriteAriaSuffix: "加入收藏",
      removeFavoriteAriaPrefix: "将",
      removeFavoriteAriaSuffix: "移出收藏",
    },
    ranking: {
      eyebrow: "Leaderboard & Community Hall of Fame",
      title: "名人堂",
      subtitle: "最高记录、用户活动等级，以及认证主播排行榜。",
      gameTab: "综合排行",
      xpTab: "经验排行",
      streamerTab: "主播排行",
      allCategories: "全部项目",
      allPlatforms: "全部平台",
      platformChzzk: "CHZZK",
      platformSoop: "SOOP",
      scoreMode: "游戏分数",
      xpMode: "经验值 (XP)",
      streakMode: "连续签到",
      dailyPeriod: "日榜",
      weeklyPeriod: "周榜",
      monthlyPeriod: "月榜",
      rankHeader: "排名",
      playerHeader: "玩家",
      streamerHeader: "主播",
      countryHeader: "国家/地区",
      categoryHeader: "项目",
      recordHeader: "记录",
      dateHeader: "达成日期",
      modeHeader: "模式",
      levelHeader: "等级",
      totalXpHeader: "总经验值",
      recordOrCategory: "记录 / 项目",
      activityLevel: "活动等级 (XP)",
      badgeHeader: "徽章",
      platformHeader: "平台",
      emptyGames: "暂无记录，成为第一个创造记录的人吧。",
      emptyXp: "暂无活跃用户。",
      emptyStreak: "暂无正在持续的连续签到记录。",
      unknownCountry: "国家/地区未设置或已隐藏",
      emptyStreamerTitle: "暂无认证主播",
      emptyStreamerBody: "暂无符合当前周期和筛选条件的认证主播游戏记录、XP 或连续签到记录。",
      retryButton: "重试",
      rank1: "第1名",
      rank2: "第2名",
      rank3: "第3名",
    },
    profile: {
      pageTitle: "设置",
      pageSubtitle: "管理账号信息与公开范围。",
      visibilityTitle: "公开范围",
      visibilitySubtitle: "选择他人访问你的资料页时可以看到的内容。",
      visibilityFavoritesLabel: "收藏",
      visibilityRecentPlaysLabel: "最近游玩",
      visibilityPublicOption: "公开",
      visibilityPrivateOption: "私密",
      visibilityUpdated: "已保存公开范围。",
      visibilityUpdateFailed: "无法保存公开范围。",
      joinedLabel: "加入日期",
      viewProfileCta: "查看个人资料",
      logout: "退出登录",
      favoritesTitle: "收藏",
      emptyFavorites: "还没有收藏的游戏。点击游戏卡片上的收藏图标即可添加。",
      recentPlaysTitle: "最近玩过",
      achievementsTitle: "成就",
      emptyAchievements: "还没有解锁的成就。快去玩游戏并添加收藏吧！",
      noRecordLabel: "该账户暂无记录",
      deviceRecordLabel: "设备记录",
      noRecordYetHint: "还没有记录 — 现在就去挑战吧！",
      justNow: "刚刚",
      minutesAgoSuffix: "分钟前",
      hoursAgoSuffix: "小时前",
      daysAgoSuffix: "天前",
      linkSuccess: "登录方式已关联。",
      alreadyLinkedAccount: "该账户已经关联。",
      linkError: "关联登录方式时发生错误。",
      streamerVerifySuccess: "主播频道所有权认证已完成。",
      streamerVerifyConflict: "该频道已关联到另一个 OwOGG 主播账户。",
      streamerVerifyUnconfigured: "当前该平台的认证暂不可用。",
      streamerVerifyUnauthorized: "登录已过期，请重新登录。",
      streamerVerifyError: "主播频道认证过程中发生错误。",
      googleScriptNotReady: "Google 登录脚本尚未准备就绪。",
      googleLinkSuccess: "Google 登录已关联。",
      googleAccountInUse: "该 Google 账户已被另一个 OwOGG 账户使用。",
      googleAlreadyLinked: "该账户已经关联了 Google 登录。",
      googleLinkFailed: "关联 Google 账户失败。",
      unlinkSuccessSuffix: "的关联已解除。",
      lastAuthProviderError: "无法解除最后一个登录方式的关联。",
      unlinkFailed: "解除关联失败。",
      mergeCompleted: "账户合并已完成。",
      nicknameUpdated: "昵称已修改。",
      nicknameCooldownPrefix: "昵称需在",
      nicknameCooldownSuffix: "之后才能再次修改。",
      nicknameUpdateFailed: "修改昵称失败。",
      nicknamePolicyHint:
        "昵称可以重复，并会在公开页面显示为“昵称 #用户编号”。修改后30天内不能再次修改。",
      nicknamePreviewLabel: "公开显示",
      avatarTitle: "头像",
      avatarSubtitle: "从已关联的 Google 或 Discord 账号头像中选择一个。",
      avatarUseButton: "使用此头像",
      avatarSelected: "当前使用",
      avatarUpdated: "头像已修改。",
      avatarUpdateFailed: "头像修改失败。",
      avatarUnavailable: "没有可用的头像。",
      countryUpdated: "国家/地区已修改。",
      countryCooldownPrefix: "国家/地区需在",
      countryCooldownSuffix: "之后才能再次修改。",
      countryUpdateFailed: "修改国家/地区失败。",
      loginRequiredTitle: "此页面需要登录",
      loginRequiredBody: "使用 Google 或 Discord 账户登录，管理你的游戏记录。",
      loginRequiredCta: "去登录",
      backButton: "返回上一页",
      levelLabel: "等级",
      globalXpRankPrefix: "全局 XP 排名 #",
      totalXpPrefix: "共 ",
      settingsTitle: "个人资料设置",
      nicknameLabel: "昵称",
      nicknamePlaceholder: "请输入昵称",
      changeButton: "修改",
      countryLabel: "国家/地区",
      countryHint: "（可选，为自行填写信息，并非国籍认证）",
      countryNotSet: "未设置",
      itemsCountSuffix: " 个",
      emptyRecentPlays: "暂无游玩记录。游玩游戏后会显示在这里。",
      connectedAccountsTitle: "已关联的登录账户",
      linkedStatus: "已关联",
      notLinkedStatus: "未关联",
      unlinkButton: "解除关联",
      linkButton: "关联",
      streamerVerificationTitle: "主播频道所有权认证",
      streamerVerificationSubtitle:
        "通过官方 OAuth / API 验证你直接拥有该频道。（禁止自行填写文本或网页抓取）",
      ownershipVerified: "已认证所有权",
      unverified: "未认证",
      verifiedConfirmedText: "✓ OwOGG 已通过官方 API 确认该用户的频道所有权。",
      audienceCountLabel: "订阅者/关注者",
      audienceUnit: " 人",
      metricsSyncedPrefix: "· 数据同步于",
      verifyChannelCta: "认证频道所有权",
      verifyUnavailable: "当前无法使用认证功能",
      featuredReviewStatusTitle: "Featured 审核状态",
      featuredStreamerLabel: "★ Featured Streamer",
      featuredSelectedSuffix: "入选",
      featuredHint:
        "Featured 基于官方频道数据资格（订阅者/关注者 12,000+ · 频道运营 120 天以上），不会影响游戏分数、XP 或排行榜排名。",
      achievedSuffix: "已达成",
      myGameRecordsTitle: "我的各游戏最高记录",
      challengeSuffix: "已挑战",
      viewFullRankingArrow: "查看完整排行榜 →",
      reviewNotStarted: "频道所有权认证完成后将开始自动审核。（约 6 小时后进行首次审核）",
      autoReviewPending: "自动审核等待中",
      nextReviewPrefix: "（下次审核",
      notEligible: "当前未达标准",
      manualReviewNeeded: "需要进一步确认",
      autoReviewFailed: "自动审核暂时失败（等待重试）",
      nextRetryPrefix: "— 下次重试",
    },
    discord: {
      heroTitle1: "与朋友一起",
      heroTitle2: "比拼游戏记录、畅快交流",
      heroSubtitle: "将 OwOGG Discord Bot 添加到你的服务器，打造专属社区排行榜和服务器专属页面。",
      installCta: "将 OwOGG 添加到 Discord",
      setupCta: "🧭 安装指南（5 步）",
      searchCta: "🔍 搜索服务器",
      registerCta: "⚡ 注册我的服务器（需管理员权限）",
      guideCta: "📖 Discord 使用指南",
      managedServersTitle: "🛡️ 我管理的注册服务器",
      exploreAll: "查看全部 →",
      loadingServers: "正在加载服务器列表...",
      noManagedServers: "暂无你管理的注册服务器",
      loginRequired: "需要登录",
      registerPrompt: "注册一个你拥有 Discord 管理员权限的服务器，开启你的社区。",
      registerStart: "开始注册服务器",
      publicPage: "公开页面",
      manageServer: "管理服务器",
      registeredLabel: "注册日期",
      weeklyRankingTitle: "本周服务器活跃排行榜",
      loadingRanking: "正在加载排行榜...",
      emptyWeeklyRanking: "本周暂无服务器活跃记录",
      guideTitle: "📌 使用说明",
      guideStep1: "只有拥有 Discord 管理员（MANAGE_GUILD）权限的用户才能注册服务器。",
      guideStep2: "公开（PUBLIC）注册后，将出现在 OwOGG 目录和搜索结果中。",
      guideStep3: "通过 /owogg play 游玩游戏会为该服务器贡献 XP，并计入每周排行榜。",
      accountLinkTitle: "🔗 关联 Discord 账户",
      accountLinkBody:
        "将 OwOGG 账户与 Discord 账户关联后，可通过机器人命令（/owogg profile）查看你的信息。",
      accountLinkCta: "前往账户关联页面",
      usageGuideCta: "查看 Discord 使用方法",
    },
    discordSetup: {
      eyebrow: "OwOGG × Discord",
      title: "Discord 安装指南",
      subtitle:
        "只需按照以下 5 个步骤，即可在服务器中直接使用 OwOGG。你不需要 Bot Token、Application ID 之类的值——这些仅由 OwOGG 运营团队负责处理。",
      step1Title: "将 OwOGG 添加到 Discord",
      step1Description: "使用拥有服务器管理员权限的账户将 Discord 应用安装到服务器。",
      checkingInstallLink: "正在确认安装链接...",
      installLinkUnavailable: "安装链接尚未准备好，请向服务器管理员咨询官方安装链接。",
      installNote:
        "安装 Discord 应用与注册 OwOGG 服务器（第 3 步）不同——仅安装并不会自动注册服务器。",
      installStatusHint:
        "该徽章无法自动确认安装状态，因此始终显示为此样式——即使你已经安装也是正常现象。如果服务器成员列表中出现了 OwOGG，说明安装已经完成。",
      step2Title: "关联 Discord 账户",
      step2Description: "关联账户后即可在 Discord 机器人命令中使用你的 OwOGG 信息。",
      checking: "正在确认...",
      owoggLoginCta: "登录 OwOGG",
      linkedNote1: "已关联。你可以在 Discord 中使用",
      linkedNote2: "。",
      linkAccountCta: "前往账户关联页面",
      step3Title: "注册服务器",
      step3Description:
        "将你拥有 Discord 服务器管理（MANAGE_GUILD）权限的服务器注册为 OwOGG 社区。",
      loginFirst: "请先登录 OwOGG。",
      alreadyRegisteredPrefix: "你已经注册/管理了 ",
      alreadyRegisteredSuffix: " 个服务器。",
      registerStartCta: "开始注册服务器",
      viewServerDirectory: "查看服务器目录",
      step4Title: "测试 /owogg games",
      step4Description: "确认斜杠命令在 Discord 频道中能正常自动补全。",
      notShowingUp: "如果自动补全中没有显示，请查看",
      troubleshootingGuide: "故障排查指南",
      checkSuffix: "。",
      step5Title: "使用 /owogg play 开始",
      step5Description: "获取绑定该服务器的游玩链接，开始积累服务器 XP。",
      viewFullGuide: "查看完整使用指南",
      footerNote1: "普通用户无需输入 Bot Token、Application ID 或 Public Key。详情请查看",
      discordWikiLink: "Discord Wiki",
      footerNote2: "。",
      badgeDone: "已完成",
      badgeTodo: "待处理",
      badgeUnknown: "请自行确认",
    },
    discordGuide: {
      eyebrow: "OwOGG × Discord",
      heroTitle: "在 Discord 中使用 OwOGG",
      heroSubtitle:
        "在服务器中开始游戏，并通过服务器 XP 和排行榜查看你的活动。OwOGG 并非常驻 Gateway 机器人，而是通过签名的 HTTP Interactions 运行。",
      installCta: "添加到 Discord",
      installLinkHint: "请向服务器管理员咨询安装链接",
      serverDirectoryCta: "服务器目录",
      heroSetupCta: "5 步安装指南",
      onboardingEyebrow: "ONBOARDING",
      onboardingTitle: "还没有完成安装、关联账户或注册服务器？",
      onboardingBody:
        "在实时清单中查看安装、账户关联、服务器注册这 5 个步骤的进度，并直接从中断处继续。",
      onboardingCta: "打开 5 步安装指南",
      xpTitle: "服务器 XP 的计算方式",
      xpSubtitle: "全局 XP 与服务器 XP 并非复制同一数值。",
      xpGlobalTitle: "全局 XP",
      xpGlobalText: "OwOGG 整体进度",
      xpGuildATitle: "Guild A 用户 XP",
      xpGuildAText: "在 A 中产生的有效贡献",
      xpGuildBTitle: "Guild B",
      xpGuildBText: "已有 XP 不会自动复制",
      antiAbuseLabel: "防刷机制：",
      antiAbuseText:
        "按用户 × 游戏 × UTC 每日计算，全局 XP 最多发放 10 次。达到上限后仍可完成游戏，但不再发放额外 XP。",
      commandsTitle: "命令",
      commandGamesDesc: "查看可游玩的游戏列表。",
      commandLinkDesc: "关联 Discord 账户与 OwOGG 账户。",
      commandProfileDesc: "查看已关联账户的资料、等级和全局 XP。",
      commandPlayDesc: "创建绑定该服务器的一次性游玩链接。",
      commandRankDesc: "查看你在当前服务器的 XP 和排名。",
      commandLeaderboardDesc: "查看当前服务器 XP 前 10 名。",
      commandServerDesc: "查看服务器总 XP 和每周活动情况。",
      rankingGuideTitle: "查看服务器排行榜",
      rankingGuideP1: "在服务器页面可查看服务器 XP、每周服务器 XP 以及各游戏的服务器参与者记录。",
      rankingGuideP2:
        "公开的全局服务器活动排行榜仅显示状态为 `PUBLIC` 的活跃服务器。参与人数按创建过 OwOGG 活动的用户计算，而非 Discord 成员总数。",
      viewFullRankingCta: "查看 OwOGG 完整排行榜",
      helpGuideTitle: "故障排查",
      helpP1: "如果提示服务器未注册，请确认管理员是否已完成服务器注册。",
      helpP2: "账户关联出错时，请重新执行 `/owogg link` 并使用未过期的链接重新确认。",
      helpP3: "如果游玩链接已过期或已被使用，需要重新发放新链接。",
      faqTitle: "常见问题",
      faq1Q: "安装应用后服务器会自动公开吗？",
      faq1A:
        "不会。安装应用与在 OwOGG 注册服务器是分开的步骤。管理员需要在网页上确认服务器并自行选择可见性。",
      faq2Q: "OwOGG 会获取 Discord 服务器的所有成员吗？",
      faq2A:
        "不会。系统通过官方 OAuth 确认可管理的服务器，XP 排行榜仅统计创建过 OwOGG 活动的参与者。",
      faq3Q: "可以将已有的全局 XP 一次性导入服务器吗？",
      faq3A:
        "不可以。新的服务器从 0 开始，仅通过 `/owogg play` 产生的有效完成记录才会归属到该服务器。",
      faq4Q: "需要运行常驻的机器人进程吗？",
      faq4A: "v1 中不需要。Discord HTTP Interactions 端点与 Cloudflare Worker 负责处理请求。",
      footerNote: "更详细的运营流程请参阅 Discord Bot 运营指南。",
      footerHubCta: "前往 Discord Hub",
    },
    discordServers: {
      pageTitle: "🔍 Discord 服务器目录",
      pageSubtitle: "浏览已在 OwOGG 注册的 Discord 社区服务器，或注册你自己的服务器。",
      registerCta: "🏰 注册我的服务器",
      searchPlaceholder: "按服务器名称或专属 slug 搜索...",
      searchButton: "搜索",
      statusNoGuilds: "未找到你拥有管理员（MANAGE_GUILD）权限的 Discord 服务器。",
      statusUnauthorized: "注册服务器需要先登录。",
      statusError: "Discord 认证过程中发生错误，请重试。",
      candidateLoadError: "无法加载可注册的服务器列表。令牌可能已过期或已被使用。",
      guildListFetchError: "获取服务器列表失败",
      registerFailError: "服务器注册失败",
      modalTitle: "🏰 注册 Discord 服务器",
      successTitle: "服务器注册成功！",
      viewPublicPage: "查看公开页面",
      manageServer: "管理服务器",
      step1Label: "1. 选择要注册的服务器（你管理的服务器）",
      step2Label: "2. 设置专属 Slug 地址（可选）",
      slugPlaceholder: "自动生成（小写字母、数字、-）",
      step3Label: "3. 选择可见性",
      cancelButton: "取消",
      submittingButton: "正在注册...",
      submitButton: "完成服务器注册",
      totalCountPrefix: "共有 ",
      totalCountSuffix: " 个公开服务器已注册。",
      searchTermLabel: "搜索关键词：",
      loadingList: "正在加载服务器列表...",
      emptyResultsTitle: "没有符合搜索条件的公开服务器。",
      emptyResultsHint: "请尝试其他关键词，或注册一个新服务器。",
      owoggServerLabel: "OwOGG 服务器",
      viewPageArrow: "查看页面 →",
    },
    discordServerSlug: {
      loadFailedGeneric: "无法加载服务器信息。",
      loadingServer: "正在加载服务器信息...",
      privateServerTitle: "私密（PRIVATE）服务器",
      notFoundTitle: "未找到服务器",
      privateServerMessage: "该服务器设置为 PRIVATE 可见性，仅拥有权限的管理员可以访问。",
      backToDirectory: "← 返回目录",
      manageServerCta: "⚙️ 服务器管理",
      participantsLabel: "OwOGG 参与成员",
      participantsUnit: " 人",
      participantsHint: "产生贡献的实际用户数",
      totalXpLabel: "服务器累计 XP",
      totalXpHint: "所有游戏活动的总和",
      weeklyXpLabel: "本周服务器 XP",
      weeklyXpHint: "以周一 00:00 KST 为准",
      leaderboardTitle: "服务器排行榜",
      tabAlltime: "⚡ 服务器 XP",
      tabWeekly: "📅 每周 XP",
      tabGames: "🎮 按游戏记录",
      emptyAlltimeTitle: "该服务器暂无累计 XP",
      emptyAlltimeHintPrefix: "在 Discord 频道中执行",
      emptyAlltimeHintSuffix: "命令，为游戏贡献一份力量吧！",
      emptyWeeklyTitle: "本周该服务器暂无累计 XP",
      emptyWeeklyHint: "在周一 00:00 KST 之后开始首次游玩，占据本周排名吧！",
      loadingGame: "正在加载游戏...",
      emptyGameScoreSuffix: "暂无服务器成员的记录分数",
      emptyGameHintPrefix: "在 Discord 频道中使用",
      emptyGameHintSuffix: "命令来挑战吧！",
      infoCardTitle: "OwOGG 服务器信息",
      statusLabel: "状态",
      visibilityLabel: "可见性",
    },
    discordServerManage: {
      noPermissionError: "你没有管理该服务器的权限。请确认已使用 Discord 管理员账户登录。",
      saveFailedError: "保存设置失败",
      unregisterFailedError: "取消注册服务器失败",
      loadingManageInfo: "正在加载服务器管理信息...",
      accessDeniedTitle: "无访问权限",
      backToDirectory: "← 前往目录",
      manageTitleSuffix: "服务器管理",
      manageSubtitle: "可设置公开/私密可见性、自定义专属 Slug 地址以及描述文字。",
      publicPageArrow: "公开页面 →",
      saveSuccessMessage: "设置已成功保存。",
      slugLabel: "专属 Slug 地址（小写字母、数字、-）",
      slugHintPrefix: "更改后 Discord Guild ID（",
      slugHintSuffix: "）本身不会改变。",
      visibilityLabel: "服务器可见性（Visibility）",
      visibilityPublicDesc: "可被搜索到并可访问公开页面",
      visibilityUnlistedDesc: "不会出现在搜索中，可通过直接链接访问",
      visibilityPrivateDesc: "不会出现在搜索中，仅管理员可访问",
      descriptionLabel: "服务器描述文字",
      descriptionPlaceholder: "请输入服务器特色或社区介绍...",
      savingButton: "正在保存...",
      saveButton: "保存设置",
      dangerZoneTitle: "危险区域（Danger Zone）",
      dangerZoneText:
        "取消注册后，服务器将从 OwOGG 目录中移除并变为 `DISABLED` 状态。（不会影响 Discord 服务器本身）",
      unregisterButton: "取消注册服务器",
      unregisterConfirmTitle: "确定要取消注册该服务器吗？",
      unregisterConfirmBodySuffix: "服务器将从 OwOGG 目录和搜索中移除。",
      cancelButton: "取消",
      unregisteringButton: "正在取消注册...",
      confirmUnregisterButton: "确认（取消注册）",
    },
    discordLink: {
      checkingLinkInfo: "正在确认关联信息...",
      invalidTitle: "无效的关联链接",
      invalidBodyPrefix: "链接已过期或已被使用。请在 Discord 服务器中重新执行",
      invalidBodySuffix: "。",
      linkingInProgress: "正在关联 Discord 账户...",
      errorTitle: "关联失败",
      genericErrorMessage: "关联过程中发生错误。",
      alreadyLinkedTitle: "已经关联",
      linkedTitle: "Discord 账户已关联",
      successBodyPrefix: "现在可以在 Discord 中使用",
      successBodySuffix: "命令查看你的 OwOGG 账户信息。",
      goToProfileCta: "前往我的资料",
      linkAccountTitle: "关联 Discord 账户",
      confirmPromptPrefix: "确定要将 Discord 账户",
      confirmPromptSuffix: "与当前登录的 OwOGG 账户关联吗？",
      loginRequiredHint: "关联前请先登录 OwOGG。",
      loginCta: "去登录",
      linkCta: "关联账户",
    },
    wiki: {
      navGettingStarted: "新手指南",
      navDiscordOverview: "Discord 概览",
      navDiscordInstall: "安装",
      navDiscordAccountLink: "账户关联",
      navDiscordServerRegistration: "服务器注册",
      navDiscordCommands: "命令",
      navDiscordXp: "服务器 XP",
      navDiscordTroubleshooting: "故障排查",
      navAccount: "账户",
      navAccountOverview: "账户概览",
      navAccountMerge: "账户合并",
      navGamesRanking: "游戏与排行榜",
      navGamesOverview: "游戏概览",
      navRanking: "排行榜",
      navGamesXp: "XP 与等级",
      navGamesDevelopment: "게임 개발 및 등록",
      navStreamerOverview: "Streamer 概览",
      navStreamerVerification: "频道所有权认证",
      navStreamerFeatured: "Featured Streamer",
      navSupport: "支持",
      catSupportDesc: "联系、举报、错误反馈渠道说明",
      tocAriaLabel: "Wiki 目录",
      homeTitle: "快速找到你想了解的内容",
      homeSubtitle: "从 Discord 安装到排行榜计算方式，使用 OwOGG 所需的一切说明都汇总在这里。",
      homeInstallPrompt: "想要更快安装 Discord？",
      homeInstallGuideLink: "5 步安装指南",
      homeInstallGuideSuffix: "，立即前往。",
      catDiscordDesc: "服务器安装、账户关联、服务器注册、命令、服务器 XP、故障排查。",
      catGettingStartedDesc: "从创建 OwOGG 账户到第一局游戏的最快路径。",
      catAccountDesc: "登录方式、个人资料设置，以及将多个账户合并为一个的账户合并功能。",
      catGamesDesc: "游戏目录、排名计算方式、经验值（XP）与等级。",
      catStreamerDesc: "频道所有权认证、主播排行榜资格、Featured Streamer 标准。",
      catPolicyTitle: "政策",
      catPolicyDesc: "查看服务条款和隐私政策。",
    },
    wikiBody: {
      streamer: {
        title: "Streamer 概览",
        description:
          "通过官方 OAuth/API 验证频道所有权的主播和 YouTuber 将被认定为 OwOGG Streamer。",
        intro:
          "Streamer 认证不会为游戏分数或 XP 提供任何加成。作为替代，它带来的权益是：在名人堂的主播排行榜标签页中展示，以及在个人资料页显示认证徽章和官方频道链接。",
        cardVerification: "频道所有权认证 →",
        cardVerificationDesc: "支持的平台与认证方法",
        cardFeatured: "Featured Streamer →",
        cardFeaturedDesc: "Featured 资格标准",
        profileHint: "可以从我的个人资料页面开始认证。",
        profileLink: "前往我的个人资料",
      },
      streamerVerification: {
        title: "频道所有权认证",
        description: "仅通过官方 OAuth 和 API 验证所有权，绝不使用文本输入或网页抓取。",
        platformsHeading: "支持的平台",
        conditionsHeading: "认证条件",
        condOnePrefix: "在上述四个平台（YouTube · CHZZK · SOOP · Twitch）中，",
        condOneStrong: "只需认证一个",
        condOneSuffix: "即可被认定为 OwOGG Streamer，无需认证全部四个平台。",
        condNoMinimum:
          "目前不要求订阅/关注人数或频道创建时长的最低标准，只需通过官方 OAuth 确认频道所有权即可。",
        condOauthOnly:
          "所有权认证始终只能通过各平台的官方 OAuth 登录页面完成，不支持直接输入频道 URL 或昵称的方式。",
        condOneChannelOneAccount: "一个外部频道只能绑定到一个 OwOGG 账户（1 个频道 = 1 个账户）。",
        methodHeading: "认证方法",
        step1: "前往个人资料页面的［主播频道所有权认证］板块。",
        step2: "点击要认证的平台的［频道所有权认证］按钮。",
        step3: "在该平台的官方登录页面使用本人账户登录并授权。",
        step4: "返回 OwOGG 后，频道信息会被自动确认并显示。",
        calloutLoginStrong: "登录 OwOGG 与频道认证是两回事。",
        calloutLoginBody:
          " 使用 Google 登录并不会自动绑定你的 YouTube 频道 —— 必须完成明确的认证流程。",
        calloutDuplicate:
          "一个外部频道只能绑定到一个 OwOGG 账户。已被其他用户认证过的频道无法再次认证。",
        footerPrefix: "若要在主播排行榜中展示，在上述四个平台中",
        footerStrong: "只需认证一个",
        footerMid: "即可。详细资格条件请参阅",
        footerLink: "排行榜文档",
        footerSuffix: "。",
      },
      streamerFeatured: {
        title: "Featured Streamer",
        description:
          "Featured 是依据 OwOGG 标准，以公开频道指标进行审核的、仅用于展示与筛选的徽章。",
        conceptHeading: "概念区分",
        conceptStreamerTerm: "Streamer",
        conceptStreamerDesc: " —— 已通过官方 OAuth/API 验证频道所有权的状态。",
        conceptFeaturedTerm: "Featured Streamer",
        conceptFeaturedDesc:
          " —— 在 Streamer 之中，满足 OwOGG 标准（订阅/关注人数、频道创建时长等公开指标）并通过自动/人工审核的状态。",
        reviewHeading: "审核方式",
        reviewBody:
          "频道所有权认证完成后不会立即授予 Featured。一段时间后会使用最新的官方指标进行自动复审；若指标存在歧义，或平台未通过官方 API 提供指标，则会安全地转入运营人工审核。获得 Featured 之后也会定期重新验证。",
        calloutNoRankImpactStrong: "Featured 不会影响分数、XP 或排行榜名次。",
        calloutNoRankImpactBody:
          " 它仅是展示用徽章 —— 无论是否为 Featured，主播排行榜都只依据频道所有权认证来展示。",
        calloutTestingPhase:
          "目前处于服务验证阶段，因此不会自动授予 Featured，所有已认证频道所有权的 Streamer 都会进入运营人工审核等待状态。无论是否为 Featured，在主播排行榜中的展示完全相同，并且 Featured 徽章目前尚未公开显示。",
        footerNote:
          "运营的审核标准与流程作为内部运营文档单独管理，不公开具体数值 —— 审核始终只使用可通过官方 API 核实的指标。",
      },
      account: {
        title: "账户概览",
        description: "OwOGG 支持 Google 与 Discord 登录，两者默认属于各自独立的账户。",
        loginHeading: "登录方式",
        loginBody:
          "你可以使用 Google 或 Discord 登录。即使是同一个人，通过 Google 创建的账户与通过 Discord 创建的账户默认也是不同的 OwOGG 账户 —— 系统不会自动合并。",
        profileHeading: "个人资料设置",
        profileBody:
          "在个人资料页面可以设置昵称和国家/地区，并查看等级、XP、成就、收藏以及最近游玩记录。",
        profileLink: "前往我的个人资料 →",
        calloutPrefix: "如果你分别创建了 Google 和 Discord 账户，可以通过",
        calloutLink: "账户合并",
        calloutSuffix: "功能将它们合并为一个。",
      },
      accountMerge: {
        title: "账户合并",
        description: "采用 Primary Account Wins 方式 —— 请先选择要保留的账户（Primary）再继续。",
        howHeading: "合并方式：Primary Account Wins",
        howBodyPrefix: "将两个账户中你要继续使用的那个指定为 ",
        howBodyPrimary: "Primary",
        howBodySuffix:
          "。合并完成后，Primary 的游戏记录、XP 和个性化设置将原封不动地保留，而 Secondary 的对应数据不会被合并，而是被清理。只有绑定在 Secondary 上的 Google/Discord 登录方式会转移到 Primary，此后无论使用哪种方式登录，都会进入同一个 Primary 账户。",
        stepsHeading: "操作步骤",
        step1: "使用你要继续使用的账户（Primary）登录。",
        step2: "启动账户合并，并使用待合并的账户（Secondary）完成身份验证。",
        step3: "确认合并内容 —— Secondary 的游戏/个性化数据不会被保留。",
        step4: "确认无误后完成合并。",
        step5: "此后使用原 Secondary 的登录方式也会登录到 Primary 账户。",
        calloutNoMergeStrong: "记录不会被合并。",
        calloutNoMergeBody:
          " 仅保留 Primary 的分数/XP/进度，Secondary 的记录在合并后会消失 —— 请务必将想保留的账户选为 Primary。",
        calloutAdminStrong: "若 Secondary 为管理员账户，合并将被阻止。",
        calloutAdminBody:
          " 若将拥有管理员权限的账户作为 Secondary 合并，该权限可能不会转移到任何地方而直接消失，因此出于安全考虑，OwOGG 会直接阻止此类合并，并要求由运营单独处理。",
        footerPrefix: "关于合并已完成平台所有权认证（Streamer）账户的规则，请参阅",
        footerLink: "Streamer 频道所有权认证",
        footerSuffix: "文档。",
      },
      games: {
        title: "游戏与排行榜概览",
        description: "OwOGG 提供包括反应速度、顺序记忆、瞄准、打字速度等在内的迷你游戏目录。",
        intro:
          "每款游戏都有各自独立的规则与计分方式，有效记录会自动计入排行榜。除分数之外，游玩行为本身也会累积经验值（XP）。",
        cardRanking: "排行榜 →",
        cardRankingDesc: "各游戏/主播排行榜的计算方式",
        cardXp: "XP 与等级 →",
        cardXpDesc: "经验值的发放方式与等级公式",
        cardDevelopment: "게임 개발 및 등록 →",
        cardDevelopmentDesc: "게임 크리에이터가 되어 직접 게임을 올리는 방법",
        footerPrefix: "现在就到",
        footerLink: "游戏目录",
        footerSuffix: "开始游玩吧。",
      },
      gamesDevelopment: {
        title: "게임 개발 및 등록",
        description: "누구나 만든 웹 게임을 게임 크리에이터로 OwOGG에 올릴 수 있습니다.",
        intro:
          "웹으로 빌드되는 것이면 장르 제약 없이 올릴 수 있습니다 — 슈터, 퍼즐, 캐주얼, 액션, 무엇이든 좋습니다. 유일한 조건은 결과물이 index.html을 진입점으로 갖는 정적 웹 파일 묶음이어야 한다는 것입니다.",
        eligibilityHeading: "게임 크리에이터 자격 얻기",
        eligibilityBody:
          "게임을 업로드하려면 먼저 게임 크리에이터 자격이 필요합니다. 운영팀이 직접 임명하는 방식으로 운영되고 있으며, 셀프서비스 신청 기능은 현재 준비 중입니다(추후 업데이트 예정). 자격이 필요하면 운영팀에 문의해주세요.",
        eligibilityLink: "게임 크리에이터 센터 확인하기",
        sdkHeading: "호스트 연동 — 2줄이면 충분",
        sdkBody:
          "게임이 OwOGG 호스트에게 알려야 할 건 '로딩 끝남'과 '게임 종료 + 점수' 두 가지뿐입니다.",
        limitsHeading: "용량 제한",
        limitBundle: "ZIP 1개당 최대 20MiB (업로드 시점 압축 크기 기준)",
        limitExtracted: "압축을 풀었을 때 총 50MiB 이하",
        limitFiles: "파일 개수 300개 이하",
        flowHeading: "제출 → 심사 → 공개",
        flowStep1:
          "업로드: 게임 크리에이터 센터에서 owogg.json이 포함된 ZIP을 끌어다 놓으면 게임 등록과 업로드가 한 번에 끝납니다. 업로드 직후는 본인에게만 보입니다.",
        flowStep2:
          "심사: 운영팀이 실제로 플레이해보고 콘텐츠를 확인합니다. 승인되어도 자동으로 공개되지 않습니다.",
        flowStep3:
          "공개: 운영팀이 별도로 공개 전환해야 그 순간부터 실제 유저에게 서비스가 시작됩니다.",
        policyHeading: "콘텐츠 정책",
        policyBody:
          "불법 콘텐츠, 혐오/차별 표현, 성인 콘텐츠, 타인의 IP를 침해하는 에셋/텍스트, 악성 코드나 다른 유저에게 피해를 주는 로직은 금지됩니다.",
        footerPrefix: "자세한 업로드 절차는 ",
        footerLink: "게임 크리에이터 센터",
        footerSuffix: "에서 직접 확인하세요.",
      },
      gamesRanking: {
        title: "排行榜",
        description:
          "名人堂（/ranking）使用相同的界面提供普通排行榜和主播排行榜。每个范围都可选择游戏记录、XP 和连续签到。",
        gameHeading: "普通排行榜",
        gameBody:
          "游戏记录和 XP 按 KST 划分为日、周、月。游戏记录只采用所选期间内每位用户的一条最佳成绩；连续签到显示当前有效天数。",
        xpHeading: "周期与达成日期",
        xpBodyPrefix: "每行显示达到排名数值的完整年月日。XP 发放方式请参阅",
        xpBodyLink: "XP 与等级文档",
        xpBodySuffix: "。",
        streamerHeading: "主播排行榜",
        streamerBodyPrefix: "只有在 YouTube / CHZZK / SOOP / Twitch 中",
        streamerBodyStrong: "至少一个",
        streamerBodySuffix:
          "平台完成官方频道所有权认证的用户才会显示。游戏记录、XP 和连续签到与普通排行榜使用相同的计算公式和 UI，认证平台数量不影响名次。",
        streamerLinkPrefix: "详细的认证方法请参阅",
        streamerLink: "Streamer 频道所有权认证",
        streamerLinkSuffix: "文档。",
        calloutFeatured:
          "Featured Streamer 标识是仅用于展示的徽章，对排行榜名次和 XP 计算没有任何影响。",
        footerPrefix: "关于 Discord 服务器维度的排行榜，请参阅",
        footerLink: "Discord 服务器 XP 文档",
        footerSuffix: "。",
      },
      gamesXp: {
        title: "XP 与等级",
        description: "每次有效完成游戏都会累积经验值，并根据累计经验值提升等级。",
        grantHeading: "XP 发放",
        grantPerPlay: "每次被认可的游戏完成可获得 10 XP。",
        grantDailyCap: "同一款游戏每天（以 UTC 为准）最多发放 10 次 XP。",
        grantAfterCap: "达到上限后仍然可以继续游玩 —— 只是不再发放额外的 XP。",
        formulaHeading: "等级公式",
        formulaPrefix: "达到等级 L 所需的累计 XP 为 ",
        formulaSuffix: "。等级越高，升到下一级所需的 XP 就越多。",
        calloutPrefix: "如果想了解在 Discord 服务器获得的 XP 与全局 XP 的关系，请查看",
        calloutLink: "Discord 服务器 XP 文档",
        calloutSuffix: "。",
        footerPrefix: "你可以在",
        footerProfileLink: "我的个人资料",
        footerMid: "查看自己的等级与 XP，在",
        footerRankingLink: "名人堂",
        footerSuffix: "查看总体排名。",
      },
      gettingStarted: {
        title: "开始使用",
        description: "以最快的方式游玩第一款游戏并留下记录。",
        flowHeading: "基本流程",
        step1: "使用 OwOGG 账户登录（Google 或 Discord）。",
        step2: "从游戏目录中选择想玩的迷你游戏。",
        step3: "游玩并查看结果 —— 有效记录会被自动保存。",
        step4: "在名人堂（排行榜）查看自己的名次与 XP。",
        step5: "如有需要，可连接 Discord 与服务器中的朋友一较高下。",
        calloutGuest:
          "以访客身份也可以游玩游戏。不过，若要将记录保存到账户并计入排行榜/XP，则需要登录。",
        cardCatalog: "游戏目录 →",
        cardCatalogDesc: "挑选现在就能玩的游戏",
        cardRanking: "名人堂 →",
        cardRankingDesc: "查看游戏/XP/主播排行榜",
        footerPrefix: "若想在 Discord 服务器中与朋友一起游玩，请查看",
        footerDiscordLink: "Discord 文档",
        footerMid: "；账户设置请查看",
        footerAccountLink: "账户文档",
        footerSuffix: "。",
      },
      discordOverview: {
        title: "Discord 概览",
        description:
          "OwOGG 不是常驻在线的 Bot，而是基于已签名的 HTTP Interactions 运作。安装、账户连接、服务器注册是三个独立的步骤。",
        calloutStrong: "普通用户无需处理 Bot Token、Application ID 或 Public Key。",
        calloutBody: " 这些值仅由 OwOGG 运营团队作为 GitHub Actions Secret 管理。",
        flowHeading: "完整流程",
        step1: "将 OwOGG 应用添加到 Discord（需要服务器管理员权限）。",
        step2: "确认并授权所选服务器。",
        step3: "返回 OwOGG 连接 Discord 账户。",
        step4: "将拥有管理权限的服务器注册为 OwOGG 社区。",
        step5: "在 Discord 中使用 /owogg games、/owogg play 开始。",
        cardInstall: "安装 →",
        cardInstallDesc: "如何将应用添加到服务器",
        cardServerReg: "服务器注册 →",
        cardServerRegDesc: "选择 PUBLIC/UNLISTED/PRIVATE",
        cardCommands: "命令 →",
        cardCommandsDesc: "/owogg 的全部子命令",
        cardTroubleshooting: "问题排查 →",
        cardTroubleshootingDesc: "按症状查找解决方法",
        footerPrefix: "想立即开始安装？请使用",
        footerLink: "5 步安装指南",
        footerSuffix: "。",
      },
      discordInstall: {
        title: "在 Discord 上安装 OwOGG",
        description: "安装 Discord 应用是在服务器中使用 OwOGG 前的准备步骤，与服务器注册是分开的。",
        calloutStrong: "普通用户无需输入 Bot Token。",
        calloutBody: " 只需点击下方的官方安装链接，并按照 Discord 的服务器选择/授权界面操作即可。",
        checklistPrefix: "如需实时查看安装、账户关联、服务器注册的进度，请使用",
        checklistLink: "5 步安装指南",
        checklistSuffix: "。",
        buttonLabel: "将 OwOGG 添加到 Discord",
        loadingPrefix: "安装链接正在加载中，或尚未就绪。",
        loadingLink: "安装指南",
        loadingSuffix: "重新查看。",
        calloutWarningStrong: "安装应用 ≠ 完成 OwOGG 服务器注册。",
        calloutWarningBodyPrefix:
          " 安装应用并不会自动将服务器发布到 OwOGG 目录。管理员需要另行完成",
        calloutWarningLink: "服务器注册",
        calloutWarningSuffix: "。",
        footerPrefix: "安装完成后的下一步是",
        footerLink: "账户连接",
        footerSuffix: "。",
      },
      discordAccountLink: {
        title: "账户连接",
        description:
          "将 Discord 账户与 OwOGG 账户连接后，Bot 命令（/owogg profile、/owogg play 等）即可使用您的个人信息。",
        methodHeading: "连接方法",
        step1: "在 Discord 服务器中输入 /owogg link 命令。",
        step2: "Bot 会回复一个仅您可见（ephemeral）的一次性连接链接。",
        step3: "点击该链接前往 OwOGG 网页。",
        step4: "如果尚未登录 OwOGG，请先登录。",
        step5: "在连接确认界面点击确认即完成。",
        calloutPrefix:
          "连接链接为一次性，且会在一段时间后失效。如果已失效或已被使用，请在 Discord 中重新执行",
        calloutCode: "/owogg link",
        calloutSuffix: "以获取新链接。",
        calloutWarning:
          "一个 Discord 账户只能归属于首次注册它的 OwOGG 账户。即使解除连接，注册归属仍会保留，不能转移到其他账户。",
        footerPrefix: "连接失败？请查看",
        footerLink1: "问题排查指南",
        footerMid: "。也可以直接在网页上打开",
        footerLink2: "账户连接页面",
        footerSuffix: "。",
      },
      discordServerRegistration: {
        title: "服务器注册",
        description:
          "安装应用与服务器注册是两回事。完成服务器注册后，服务器 XP、排行榜与专属服务器页面才会生效。",
        requirementsHeading: "注册要求",
        req1: "必须已登录 OwOGG 账户。",
        req2: "必须在要注册的 Discord 服务器中拥有服务器管理（Manage Server）权限。",
        req3: "OwOGG 应用必须已安装在该服务器中。",
        stepsHeading: "注册步骤",
        step1: "在登录 OwOGG 的状态下，开始 Discord 服务器注册验证。",
        step2: "授权 Discord 请求的权限（查看服务器列表）。",
        step3: "从可管理的服务器列表中选择要注册的服务器。",
        step4: "设置服务器的 slug（URL 名称）、简介和公开范围。",
        step5: "注册完成后，服务器专属页面会立即创建。",
        buttonLabel: "开始服务器注册",
        visibilityHeading: "公开范围（Visibility）",
        visibilityPublicDesc: "会显示在 OwOGG 服务器目录及搜索结果中。",
        visibilityUnlistedDesc: "仅可通过直接链接访问，不会显示在目录中。",
        visibilityPrivateDesc: "仅服务器管理员可访问。",
        calloutStrong: "安装应用 ≠ 服务器注册。",
        calloutBody: " 安装应用并不会使服务器自动公开，必须通过上述流程手动注册。",
        footerPrefix: "服务器不在列表中？请查看",
        footerLink: "问题排查指南",
        footerSuffix: "中的「服务器不在注册候选列表中」部分。",
      },
      discordCommands: {
        title: "命令",
        description: "所有 OwOGG Discord 命令都是 /owogg 的子命令。",
        calloutEphemeral:
          "显示的响应为临时（ephemeral）消息，仅执行命令的用户可见 —— 频道中的其他人无法看到。",
        labelWhere: "使用位置",
        labelAccountLink: "需要账户连接",
        labelGuildRequired: "需要服务器注册",
        labelArgs: "参数",
        labelExample: "示例",
        labelCommonError: "常见错误：",
        yes: "是",
        no: "否",
        footerPrefix: "行为与预期不符？请查看",
        footerLink: "问题排查指南",
        footerSuffix: "。",
        commands: [
          {
            purpose: "将此 Discord 账户与 OwOGG 账户连接。",
            where: "服务器频道或私信",
            args: "无",
            commonError: "若已连接，将收到提示消息而非新链接。",
          },
          {
            purpose: "查看已连接 OwOGG 账户的昵称、等级和总 XP。",
            where: "服务器频道或私信",
            args: "无",
            commonError: "若账户未连接，将收到 /owogg link 的提示。",
          },
          {
            purpose: "查看当前 OwOGG 上可玩的游戏列表及链接。",
            where: "服务器频道或私信，无需登录",
            args: "无",
            commonError: "无（始终公开响应）",
          },
          {
            purpose: "颁发一个一次性游戏游玩链接，其 XP 将归属于此服务器。",
            where: "已注册的服务器频道",
            args: "game（可选）—— 指定特定游戏，省略则跳转至游戏列表",
            commonError: "若服务器未注册或账户未连接，将收到提示消息。链接 15 分钟内仅可使用一次。",
          },
          {
            purpose: "查看您在此服务器中的排名及服务器贡献 XP。",
            where: "已注册的服务器频道",
            args: "无",
            commonError: "若账户未连接，或在此服务器中尚无活动，将收到提示消息。",
          },
          {
            purpose: "查看此服务器的 OwOGG XP 排行榜前 10 名。",
            where: "已注册的服务器频道",
            args: "无",
            commonError: "若服务器未注册，将收到提示消息。",
          },
          {
            purpose: "查看此服务器的总 XP 与每周活动摘要。",
            where: "已注册的服务器频道",
            args: "无",
            commonError: "若服务器未注册，将收到提示消息。",
          },
        ],
      },
      discordXp: {
        title: "服务器 XP 的计算方式",
        description: "全局 XP、按服务器划分的用户 XP、服务器活动 XP 是三个不同的数值。",
        differHeading: "三种不同的 XP",
        globalTerm: "常规 OwOGG XP（全局）",
        globalDesc: " —— 账户整体累计的经验值，用于个人资料和总排行榜。",
        perGuildTerm: "Discord 按服务器划分的用户 XP",
        perGuildDescPrefix: " —— 仅累计在该服务器中通过",
        perGuildDescCode: "/owogg play",
        perGuildDescSuffix: "产生的有效完成。",
        guildActivityTerm: "Discord 服务器活动 XP",
        guildActivityDesc: " —— 服务器全体成员贡献的总和，用于服务器排行榜和每周排名。",
        exampleHeading: "示例",
        exampleBodyPrefix: "一名全局 XP 为 25,000 的用户，在新注册的 Guild A 中通过",
        exampleBodyCode: "/owogg play",
        exampleBodySuffix: "产生 1 次有效完成（+10）：",
        cardGlobalTitle: "全局 XP",
        cardGlobalText: "账户整体累计",
        cardGuildATitle: "Guild A 用户 XP",
        cardGuildAText: "在 A 中产生的有效贡献",
        cardGuildBTitle: "Guild B",
        cardGuildBText: "已有 XP 不会自动复制",
        calloutNoCopyStrong: "已有的全局 XP 不会自动复制到新服务器。",
        calloutNoCopyBody: " 新注册的服务器始终从 0 开始，只累计在该服务器中新产生的有效游玩。",
        calloutAbuseStrong: "防刷机制：",
        calloutAbuseBody:
          " 按用户 × 游戏 × UTC 自然日计算，全局 XP 的发放上限为 10 次。达到上限后仍可继续完成游戏，但不会再发放额外 XP。每个游玩事件最多只能归属于一个服务器 —— 同一次完成不会在多个服务器中重复产生 XP。",
        footerPrefix: "查看服务器排行榜的方法请参考",
        footerLink: "游戏与排行榜文档",
        footerSuffix: "。",
      },
      discordTroubleshooting: {
        title: "问题排查",
        description: "请按症状查找。在任何情况下，普通用户都不需要设置 Bot Token。",
        calloutWarning:
          "以下任何症状都不会要求您输入 Bot Token、Application ID 或 Public Key。如果收到此类要求，可能并非官方 OwOGG 渠道。",
        faqAutocomplete: {
          question: "/owogg 没有出现在自动补全中",
          answerPrefix:
            "请尝试重启 Discord 客户端，或退出服务器后重新加入。如果仍未出现，请让服务器管理员确认应用是否确实已安装在此服务器。OwOGG 运营方可通过",
          answerCode: "pnpm discord:commands:check",
          answerSuffix: "确认全局命令的注册状态。",
        },
        faqPlainMessage: {
          question: "输入 /owogg link 后以普通消息形式发出",
          answer:
            "如果不是以正常的斜杠命令发送，而是以普通文本发送，说明 Discord 没有将其识别为命令。您需要从自动补全列表中准确选择 /owogg，再选择子命令来执行。直接手动输入并发送会变成普通消息。",
        },
        faqNoResponse: {
          question: "应用程序未响应",
          answer:
            "可能是暂时的延迟或错误。请稍后重试。若反复出现，可能是 OwOGG 服务状态存在问题，请稍后再次确认。",
        },
        faqAlreadyLinked: {
          question: "提示账户已连接",
          answer:
            "这表示此 Discord 账户已注册到另一个 OwOGG 账户。它会一直归属于首次注册的 OwOGG 账户，即使解除连接也不能重新注册到其他账户。",
        },
        faqServerNotRegistered: {
          question: "/owogg play 提示服务器未注册",
          answerPrefix: "此 Discord 服务器尚未注册为 OwOGG 社区。服务器管理员需要完成",
          answerLink: "服务器注册",
          answerSuffix: "。仅安装应用并不会完成注册。",
        },
        faqNotInCandidateList: {
          question: "服务器不在注册列表（注册候选）中",
          answer:
            "可注册的服务器列表仅显示您实际拥有服务器管理（Manage Server）权限的服务器。请确认您是否拥有该权限，或登录的 Discord 账户是否为目标服务器所在账户。",
        },
        faqBotNotVisible: {
          question: "Bot 未出现在 Discord 成员列表中",
          answer:
            "OwOGG 不是常驻在线（Gateway）Bot，而是基于已签名的 HTTP Interactions 方式运作。因此可能不会始终在成员列表中显示为「在线」—— 这是正常现象，不影响命令的正常使用。",
        },
        faqBotOffline: {
          question: "Bot 显示为离线",
          answer:
            "原因与上述相同。基于 HTTP Interactions 的应用不会保持常驻连接状态，因此可能在 Discord 成员列表中显示为离线。只要命令能正常执行，就不是问题。",
        },
        footerPrefix: "这里没有您遇到的问题？请查看",
        footerLink: "Discord 使用指南",
        footerSuffix: "中的 FAQ。",
      },
      support: {
        title: "联系 · 举报 · 错误反馈",
        description: "发送到对应的渠道，我们能更快为您处理。",
        generalHeading: "一般咨询 (contact@owogg.com)",
        generalBody: "账号问题、使用方法、功能建议等其他所有咨询。",
        reportHeading: "举报 (report@owogg.com)",
        reportBody: "作弊、滥用、不当内容等违反社区准则的行为举报。",
        bugHeading: "错误反馈 (bug@owogg.com)",
        bugBody:
          "游戏错误、功能异常、画面显示问题等技术问题。请告诉我们具体是哪个游戏/页面、在什么情况下发生的，这样能更快确认问题。",
        tipsHeading: "通用提示",
        tip1: "如可以的话，请附上截图。",
        tip2: "账号相关问题请附上注册时使用的邮箱或昵称。",
        tip3: "举报时请附上举报对象(昵称/内容等)和具体情况。",
        footerPrefix: "如需一次查看全部渠道并直接发送邮件，请使用",
        footerLink: "联系我们页面",
        footerSuffix: "。",
      },
    },
    legal: {
      terms: {
        metaTitle: "服务条款",
        metaDescription: "OwOGG 服务条款",
        pageTitle: "服务条款",
        effectiveDate: "生效日期：2026年8月14日",
        section1Heading: "1. 服务概述",
        section1Body:
          "OwOGG（以下简称「服务」）是一个无需安装、可在浏览器中直接游玩的网页小游戏集合平台，同时提供 Discord 服务器联动、排行榜/经验值（XP）、Streamer 频道认证等附加功能。",
        section2Heading: "2. 账号与登录",
        section2Body:
          "本服务仅支持通过 Google 或 Discord 账号进行 OAuth 登录，不直接发放单独的账号/密码（管理员专用账号除外）。用户必须仅使用自己拥有的账号登录，账号管理的责任由用户本人承担。",
        section3Heading: "3. 用户的义务",
        section3Intro: "用户不得从事以下行为：",
        section3List: [
          "利用自动化工具、宏等不正当篡改游戏记录或经验值的行为",
          "将不属于本人的账号、频道、Discord 服务器伪造成本人所有进行注册或认证的行为",
          "未经授权收集、发布他人个人信息，或通过本服务对他人造成损害的行为",
          "干扰服务正常运营的攻击、过度请求或利用漏洞的行为",
        ],
        section4Heading: "4. 内容与游戏记录",
        section4Body:
          "用户生成的游戏记录、昵称、个人资料信息将用于排行榜/XP 等服务提供目的。本服务可以在不事先通知的情况下调整或删除判定为不正当记录的数据。",
        section5Heading: "5. 服务的变更与中断",
        section5Body:
          "本服务可根据运营和技术需要，在不事先通知的情况下变更或中断所提供的游戏、功能及页面结构。本服务免费提供，不保证可用性或特定性能。",
        section6Heading: "6. 免责声明",
        section6Body:
          "本服务为免费提供的个人/小规模项目，在相关法律法规允许的范围内，不对因使用本服务而产生的损害承担责任。但因故意或重大过失造成的损害除外。",
        section7Heading: "7. 条款的变更",
        section7Body:
          "本条款可在必要时进行修订，修订时将通过本页面进行告知。修订后的条款自发布之日起生效。",
        section8Heading: "8. 联系我们",
        section8BodyPrefix: "与服务使用相关的咨询，请发送邮件至 ",
        section8BodyEmail: "contact@owogg.com",
        section8BodySuffix: " 与我们联系。",
      },
      privacy: {
        metaTitle: "隐私政策",
        metaDescription: "OwOGG 隐私政策",
        pageTitle: "隐私政策",
        effectiveDate: "生效日期：2026年8月14日",
        section1Heading: "1. 收集的个人信息项目",
        section1Intro: "OwOGG 为提供服务仅收集以下信息：",
        section1List: [
          {
            term: "登录信息",
            desc: " — 使用 Google 或 Discord 账号登录时提供的电子邮件、昵称（显示名称）、头像 URL、账号唯一标识符（sub/ID）",
          },
          {
            term: "游戏使用记录",
            desc: " — 各游戏的分数/记录、经验值（XP）、等级、成就完成记录",
          },
          {
            term: "个人资料设置",
            desc: " — 用户直接输入的昵称、国家/地区（可选，为自主申报信息，非国籍认证）",
          },
          {
            term: "Discord 联动信息",
            desc: " — 绑定账号时的 Discord 用户 ID，注册服务器（公会）时的服务器 ID/名称/图标、管理权限状态",
          },
          {
            term: "Streamer 频道认证信息",
            desc: " — 为参与主播排行榜而自愿完成频道所有权认证时，通过相应平台（YouTube/Twitch/CHZZK/SOOP）官方 API 确认的频道名称、频道 URL、订阅者/粉丝数量",
          },
        ],
        section1Outro:
          "不另外收集密码（管理员专用账号除外，该密码经 PBKDF2 哈希处理后存储，绝不以明文保管）。",
        section2Heading: "2. 收集目的",
        section2List: [
          "会员识别及维持登录状态",
          "提供游戏记录·排行榜·经验值系统",
          "在 Discord 机器人命令中查询本人账号信息，按服务器统计活动",
          "确认 Streamer/主播排行榜资格",
          "检测不正当使用（滥用）及维持服务稳定性",
        ],
        section3Heading: "3. 保管期限",
        section3Body:
          "个人信息保管至会员注销或用户请求删除时止，相关法律法规要求单独保管的情况除外。",
        section4Heading: "4. 向第三方提供",
        section4Body:
          "OwOGG 不会出于广告、营销等目的向第三方提供或出售用户的个人信息。仅使用服务运营所需的底层基础设施（Cloudflare — 服务器/数据库托管），这不属于向第三方提供营销信息。",
        section5Heading: "5. 用户的权利",
        section5Body:
          "用户可随时请求查阅、更正或删除（账号注销）其个人信息。请联系以下联系方式，经确认后将进行处理。",
        section6Heading: "6. Cookie 与 Session",
        section6Body:
          "使用 Session Cookie 以维持登录状态。不使用用于广告目的的追踪 Cookie 或第三方分析工具。",
        section7Heading: "7. 联系我们",
        section7BodyPrefix: "隐私相关的咨询，请发送邮件至 ",
        section7BodyEmail: "contact@owogg.com",
        section7BodySuffix: " 与我们联系。",
      },
    },
    gamePlay: {
      errorGameNotFound: "未找到该游戏。",
      gameDisabledTitle: "该游戏目前不可用",
      gameDisabledBody: "运营者已暂时禁用该游戏，请稍后再试。",
      errorLoadFailed: "加载游戏时发生错误。",
      errorSubmitFailed: "保存分数失败。",
      errorNetworkSubmitFailed: "由于网络错误，分数未能保存。",
      errorSubmitFallback: "记录保存失败",
      backToList: "返回列表",
      back: "返回",
      loadingTitle: "游戏加载中...",
      loadingBody: "正在加载游戏...",
      authRequiredTitle: "此游戏需要登录",
      authRequiredBody: "登录账号后即可游玩此小游戏并登记排行榜。",
      authRequiredCta: "登录并开始游戏",
      resultTitle: "游戏结束！",
      finalScoreLabel: "最终得分",
      deviceBestLabel: "本机最佳记录",
      metadataWpm: "速度（WPM）",
      metadataCpm: "击键数（CPM）",
      metadataAccuracy: "准确度",
      metadataCorrectChars: "正确",
      metadataIncorrectChars: "错误",
      metadataTotalTypedChars: "总输入数",
      metadataDurationMs: "用时（ms）",
      metadataTargetsHit: "命中目标",
      metadataMisses: "未命中",
      metadataLevel: "达到等级",
      metadataTargets: "目标数",
      metadataAvgPerTargetMs: "每目标平均用时（ms）",
      metadataSequenceLength: "序列长度",
      metadataGrade: "评级",
      metadataAuthoritativeRawScore: "已验证原始分数",
      guestNoticeTitle: "访客记录仅保存在本设备。",
      guestNoticeBody: "登录后，从下一次游玩开始即可参与排行榜。",
      guestLoginCta: "登录",
      submittingLabel: "正在提交分数到排行榜...",
      successLabel: "记录已登记到排行榜！",
      retrySubmitCta: "重新提交分数",
      leaderboardYou: "我",
      retryGameCta: "🔄 再玩一次",
      returnToGameCta: "返回游戏画面",
      backToListResult: "返回列表",
      difficultyNormal: "普通",
      difficultyHard: "困难",
      shareText: "我在{title}中获得了{score}！来挑战一下吧 🎮",
      shareXCta: "分享到 X",
      shareDiscordCta: "复制 Discord 用文本",
      shareDiscordCopiedFeedback: "已复制！请粘贴到 Discord",
      shareXScreenshotHint: "截图已复制！请在推文框中粘贴(Ctrl+V)",
      screenshotCopyCta: "复制截图",
      screenshotCopiedFeedback: "图片已复制！",
      screenshotDownloadedFeedback: "图片已下载",
      screenshotErrorFeedback: "生成截图失败",
      leaderboardTitle: "排行榜",
      leaderboardEmpty: "暂无记录。",
      viewFullRanking: "查看完整排行榜 →",
      fullscreenEnterCta: "全屏",
      fullscreenExitCta: "退出全屏",
      fullscreenRecommendedHint: "推荐",
      mobileExperimentalNotice: "移动端支持为实验性功能。",
      mobileUnsupportedNotice: "此游戏可能不支持移动设备。",
      orientationPortraitHint: "此游戏针对竖屏进行了优化。",
      orientationLandscapeHint: "此游戏针对横屏进行了优化。",
      bookmarkCta: "收藏",
      bookmarkedCta: "已收藏",
      shareGameCta: "分享",
      shareGameCopied: "链接已复制",
      feedbackCta: "反馈",
      mobilePlayCta: "在手机上玩",
      theaterModeEnterCta: "影院模式",
      theaterModeExitCta: "默认视图",
      adLabel: "广告",
      adPlaceholder: "用于保持内容布局稳定的预留广告位。",
      recommendedGamesTitle: "接下来玩",
      recommendedGamesEmpty: "目前还没有其他可推荐的公开游戏。",
      gameInfoTitle: "游戏信息",
      publisherLabel: "制作者",
      publishedLabel: "上传时间",
      playerStatsLabel: "玩家",
      bookmarkStatsLabel: "收藏",
      officialGameBadge: "官方游戏",
      userGameBadge: "用户制作",
      mobilePlayTitle: "在手机上继续游玩",
      mobilePlayBody: "复制或分享下方链接，然后在手机浏览器中打开同一款游戏。",
      copyGameLinkCta: "复制游戏链接",
      closeDialogCta: "关闭",
      gameLinkCopied: "游戏链接已复制。",
    },
    gameRanking: {
      eyebrow: "游戏排行榜",
      backToGame: "返回游戏",
      notSupported: "该游戏不支持排名",
      notSupportedBody: "这是一款无需排名、轻松享受的休闲游戏。",
    },
    userProfile: {
      eyebrow: "玩家资料",
      backToHome: "返回首页",
      notFoundTitle: "找不到该用户",
      notFoundBody: "该账号不存在或已被删除。",
      loadErrorBody: "无法加载该资料。",
      retryButton: "重试",
      joinedPrefix: "加入日期",
      levelLabel: "等级",
      globalRankPrefix: "全站经验排名 #",
      streakLabel: "连续登录",
      streakDaysSuffix: "天",
      longestStreakPrefix: "最高纪录",
      achievementsTitle: "成就",
      achievementsEmpty: "尚未解锁任何成就。",
      achievedSuffix: "已解锁",
      gameRecordsTitle: "各游戏最佳记录",
      gameRecordsEmpty: "暂无记录。",
      streamerBadgesTitle: "认证主播频道",
      manageProfileCta: "设置 →",
      favoritesTitle: "收藏",
      favoritesEmpty: "还没有收藏的游戏。",
      recentPlaysTitle: "最近游玩",
      recentPlaysEmpty: "还没有游玩记录。",
      itemsCountSuffix: "个",
      onlyVisibleToYou: "仅自己可见",
      settingsCta: "在设置中修改",
    },
    registeredServers: {
      ariaLabel: "已注册的 Discord 服务器",
      title: "已注册的服务器",
      empty: "暂无已注册的服务器。",
      viewAll: "查看全部服务器 →",
    },
    changelog: {
      eyebrow: "Changelog",
      title: "更新日志",
      subtitle: "查看 OwOGG 的更新与公告。",
      emptyState: "暂无更新记录。",
      tagFeature: "新功能",
      tagImprovement: "改进",
      tagFix: "修复",
    },
    platformIcon: {
      chzzkLabel: "CHZZK",
      soopLabel: "SOOP",
      channelSuffix: "频道",
      verifiedPlatforms: "已验证平台",
    },
    contact: {
      eyebrow: "联系我们",
      title: "有什么可以帮您?",
      subtitle: "发送到对应的渠道，我们能更快处理您的问题。",
      emailCta: "复制邮箱地址",
      emailCopiedFeedback: "已复制！",
      generalLabel: "一般咨询",
      generalDesc: "账号、使用方法、建议等其他问题",
      reportLabel: "举报",
      reportDesc: "作弊、滥用、不当内容举报",
      bugLabel: "错误反馈",
      bugDesc: "游戏错误、功能异常等问题反馈",
      guidanceTitle: "联系前请注意",
      guidanceItems: [
        "反馈错误时，请说明是在哪个游戏/页面、什么情况下发生的。",
        "如可以的话，附上截图会有很大帮助。",
        "账号相关问题请附上注册时使用的邮箱或昵称。",
        "举报时请附上举报对象(昵称/内容等)和具体情况。",
      ],
      discordAltTitle: "也可以通过 Discord 联系我们",
      discordAltBody: "如果想要更快速的沟通，可以查看社区服务器的 Discord 指南。",
      discordAltCta: "查看 Discord 指南",
    },
  },
};
