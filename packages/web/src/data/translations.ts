import { useLanguage, type LanguageCode } from './languageStore';

type Dictionary = Record<string, string>;

const en: Dictionary = {
  'nav.home': 'Home',
  'nav.assistant': 'Assistant',
  'nav.emergency': 'Emergency',
  'nav.firstAid': 'First Aid',
  'home.hello': 'Hello',
  'home.vitals': 'Vitals',
  'home.medications': 'Medications',
  // Present in the hi/te dictionaries but missing here, so the DEFAULT
  // language was the only one rendering the raw key ("home.startEmergency")
  // on the Home screen.
  'home.startEmergency': 'Start emergency',
  'home.healthSummary': 'Health summary',
  'home.emergency': 'Emergency',
  'home.firstAid': 'First aid',
  'home.medicineScanner': 'Medicine scanner',
  'home.emergencySub': 'Start the triage interview',
  'home.firstAidSub': 'Works with no signal',
  'home.medicineScannerSub': 'Photograph a pack for its name & expiry',
  'settings.title': 'Settings',
  'settings.profile': 'Profile',
  'settings.language': 'Language',
  'settings.notifications': 'Medication notifications',
  'settings.motion': 'Motion',
  'settings.localData': 'Local data',
  'profile.title': 'Profile',
};

const hi: Dictionary = {
  'nav.home': 'मुख्य पृष्ठ',
  'nav.assistant': 'सहायक',
  'nav.emergency': 'आपातकाल',
  'nav.firstAid': 'प्राथमिक उपचार',
  'home.hello': 'नमस्ते',
  'home.vitals': 'जीवन लक्षण',
  'home.medications': 'दवाइयाँ',
  'home.healthSummary': 'स्वास्थ्य सारांश',
  'home.startEmergency': 'आपातकाल शुरू करें',
  'home.emergency': 'आपातकाल',
  'home.firstAid': 'प्राथमिक उपचार',
  'home.medicineScanner': 'दवा स्कैनर',
  'home.emergencySub': 'ट्राइएज साक्षात्कार शुरू करें',
  'home.firstAidSub': 'बिना सिग्नल के काम करता है',
  'home.medicineScannerSub': 'दवा की जानकारी के लिए फोटो खींचें',
  'settings.title': 'सेटिंग्स',
  'settings.profile': 'प्रोफ़ाइल',
  'settings.language': 'भाषा',
  'settings.notifications': 'दवा सूचनाएं',
  'settings.motion': 'मोशन',
  'settings.localData': 'स्थानीय डेटा',
  'profile.title': 'प्रोफ़ाइल',
};

const te: Dictionary = {
  'nav.home': 'హోమ్',
  'nav.assistant': 'సహాయకుడు',
  'nav.emergency': 'అత్యవసర',
  'nav.firstAid': 'ప్రథమ చికిత్స',
  'home.hello': 'నమస్కారం',
  'home.vitals': 'ప్రాణాధారాలు',
  'home.medications': 'మందులు',
  'home.healthSummary': 'ఆరోగ్య సారాంశం',
  'home.startEmergency': 'అత్యవసర ప్రారంభించండి',
  'home.emergency': 'అత్యవసర',
  'home.firstAid': 'ప్రథమ చికిత్స',
  'home.medicineScanner': 'మెడిసిన్ స్కానర్',
  'home.emergencySub': 'ట్రయాజ్ ఇంటర్వ్యూ ప్రారంభించండి',
  'home.firstAidSub': 'సిగ్నల్ లేకుండా పనిచేస్తుంది',
  'home.medicineScannerSub': 'మందుల ప్యాక్ ఫోటో తీయండి',
  'settings.title': 'సెట్టింగ్స్',
  'settings.profile': 'ప్రొఫైల్',
  'settings.language': 'భాష',
  'settings.notifications': 'మందుల నోటిఫికేషన్లు',
  'settings.motion': 'మోషన్',
  'settings.localData': 'స్థానిక డేటా',
  'profile.title': 'ప్రొఫైల్',
};

const dictionaries: Record<LanguageCode, Dictionary> = { en, hi, te };

export function useTranslation() {
  const { language } = useLanguage();
  const dict = dictionaries[language] || en;

  const t = (key: string): string => {
    return dict[key] || en[key] || key;
  };

  return { t, language };
}
