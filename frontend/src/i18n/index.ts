export type UILang = 'en' | 'ja'

const t = {
  en: {
    // Auth
    appTagline:          'Talk to anyone, in any language.',
    createAccount:       'Create account',
    creatingAccount:     'Creating account...',
    signIn:              'Sign in',
    signingIn:           'Signing in...',
    alreadyHaveAccount:  'Already have an account?',
    noAccount:           'No account?',
    register:            'Register',
    registrationKey:     'Registration key',
    inviteKeyPlaceholder:'Enter your invite key',
    displayName:         'Display name',
    displayNamePlaceholder: 'Your name',
    username:            'Username',
    usernamePlaceholder: 'e.g. alice_99',
    usernameHint:        '3–20 chars: lowercase letters, digits, underscores',
    email:               'Email',
    emailPlaceholder:    'you@example.com',
    password:            'Password',
    passwordPlaceholder: 'Min. 8 characters',
    yourLanguage:        'Your language',

    // Profile
    profile:             'Profile',
    backToChat:          'Back to chat',
    currentPassword:     'Current password',
    passwordRequired:    '(required to save changes)',
    saveChanges:         'Save changes',
    saving:              'Saving…',
    profileUpdated:      'Profile updated successfully.',
    profileSaveFailed:   'Failed to save changes.',
    enterPasswordToSave: 'Enter your current password to save changes.',

    // Sidebar
    searchPlaceholder:   'Search @username to add friends',
    friendRequests:      'Friend requests',
    friends:             'Friends',
    requested:           'Requested',
    checkRequests:       'Check requests',
    add:                 'Add',
    accept:              'Accept',
    decline:             'Decline',
    loading:             'Loading…',
    searching:           'Searching…',
    noUsersFound:        'No users found.',
    noFriendsYet:        'No friends yet.',
    noFriendsHint:       'Search by @username above to add friends.',

    // Conversation pane
    send:                'Send',
    back:                'Back',
    startVideoCall:      'Start video call',
    unfriend:            'Unfriend',
    removing:            'Removing…',
    addBack:             'Add back',
    sending:             'Sending…',
    requestSent:         'Request sent',
    friendRequestSent:   (name: string) => `Friend request sent to ${name}`,
    noLongerFriends:     'You are no longer friends.',
    loadingMessages:     'Loading messages…',
    beginningOfConvo:    (name: string) => `This is the beginning of your conversation with ${name}.`,
    translationUnavailable: 'translation unavailable',
    writeInLang:         (lang: string) => `Write in ${lang}…`,
    addBackToSend:       'Add back to send messages',

    // Call overlay
    startingCall:        'Starting…',
    ringing:             'Ringing…',
    connecting:          'Connecting…',
    callEnded:           'Call ended',
    callDeclined:        'Call declined',
    mute:                'Mute',
    unmute:              'Unmute',
    cameraOn:            'Camera on',
    cameraOff:           'Camera off',
    switchCamera:        'Switch camera',
    endCall:             'End call',

    // Incoming call
    incomingCall:        'Incoming call',
    answerCall:          '📞 Answer',
    declineCall:         '📵 Decline',

    // ChatApp
    signOut:             'Sign out',
    warmupTitle:         'Warm up ML service before a call',
    selectConversation:  'Select a conversation to start talking.',
    translatedRealTime:  'Messages are translated in real time.',

    // Landing
    getStarted:          'Get started',
    learnMore:           'Learn more',
  },
  ja: {
    // Auth
    appTagline:          'どんな言語でも、誰とでも話せる。',
    createAccount:       'アカウント作成',
    creatingAccount:     'アカウントを作成中...',
    signIn:              'サインイン',
    signingIn:           'サインイン中...',
    alreadyHaveAccount:  'すでにアカウントをお持ちですか？',
    noAccount:           'アカウントをお持ちでない方は',
    register:            '登録',
    registrationKey:     '招待キー',
    inviteKeyPlaceholder:'招待キーを入力',
    displayName:         '表示名',
    displayNamePlaceholder: 'お名前',
    username:            'ユーザー名',
    usernamePlaceholder: '例: alice_99',
    usernameHint:        '3〜20文字：英小文字・数字・アンダースコア',
    email:               'メールアドレス',
    emailPlaceholder:    'you@example.com',
    password:            'パスワード',
    passwordPlaceholder: '8文字以上',
    yourLanguage:        '使用言語',

    // Profile
    profile:             'プロフィール',
    backToChat:          'チャットに戻る',
    currentPassword:     '現在のパスワード',
    passwordRequired:    '（変更を保存するために必要）',
    saveChanges:         '保存',
    saving:              '保存中…',
    profileUpdated:      'プロフィールを更新しました。',
    profileSaveFailed:   '保存に失敗しました。',
    enterPasswordToSave: '変更を保存するには現在のパスワードを入力してください。',

    // Sidebar
    searchPlaceholder:   '@ユーザー名で検索して友達追加',
    friendRequests:      '友達リクエスト',
    friends:             '友達',
    requested:           'リクエスト済み',
    checkRequests:       'リクエストを確認',
    add:                 '追加',
    accept:              '承認',
    decline:             '拒否',
    loading:             '読み込み中…',
    searching:           '検索中…',
    noUsersFound:        'ユーザーが見つかりません。',
    noFriendsYet:        'まだ友達がいません。',
    noFriendsHint:       '上の検索で@ユーザー名を入力して友達を追加しましょう。',

    // Conversation pane
    send:                '送信',
    back:                '戻る',
    startVideoCall:      'ビデオ通話を開始',
    unfriend:            '友達を削除',
    removing:            '削除中…',
    addBack:             '友達に戻す',
    sending:             '送信中…',
    requestSent:         'リクエスト送信済み',
    friendRequestSent:   (name: string) => `${name}に友達リクエストを送りました`,
    noLongerFriends:     'もう友達ではありません。',
    loadingMessages:     'メッセージを読み込み中…',
    beginningOfConvo:    (name: string) => `${name}との会話の始まりです。`,
    translationUnavailable: '翻訳できません',
    writeInLang:         (lang: string) => `${lang}で入力…`,
    addBackToSend:       'メッセージを送るには友達に戻してください',

    // Call overlay
    startingCall:        '接続中…',
    ringing:             '呼び出し中…',
    connecting:          '接続中…',
    callEnded:           '通話終了',
    callDeclined:        '通話を拒否されました',
    mute:                'ミュート',
    unmute:              'ミュート解除',
    cameraOn:            'カメラオン',
    cameraOff:           'カメラオフ',
    switchCamera:        'カメラ切替',
    endCall:             '通話終了',

    // Incoming call
    incomingCall:        '着信中',
    answerCall:          '📞 応答',
    declineCall:         '📵 拒否',

    // ChatApp
    signOut:             'サインアウト',
    warmupTitle:         '通話前にMLサービスを起動',
    selectConversation:  '会話を選んで話し始めましょう。',
    translatedRealTime:  'メッセージはリアルタイムで翻訳されます。',

    // Landing
    getStarted:          'はじめる',
    learnMore:           '詳しく見る',
  },
} as const

export default t
