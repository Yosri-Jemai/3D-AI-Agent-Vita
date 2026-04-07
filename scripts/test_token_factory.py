"""
test_token_direct.py
=====================
Test direct de l'API Token Factory (fournie par notre ecole) sans OpenAI SDK
"""

import requests
import os
from dotenv import load_dotenv

# Désactiver les warnings SSL (pour test seulement)
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

load_dotenv()

api_key = os.getenv("TOKEN_FACTORY_API_KEY")
base_url = os.getenv("TOKEN_FACTORY_BASE_URL", "https://tokenfactory.esprit.tn")

# URL complète
url = f"{base_url}/api/chat/completions"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Content-Type": "application/json"
}

data = {
    "model": "hosted_vllm/Llama-3.1-70B-Instruct",
    "messages": [
        {"role": "user", "content": "tu connais la tunisie ?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100,
    "top_p": 0.9,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0
}

print("=" * 60)
print("Test Token Factory API")
print("=" * 60)
print(f"URL: {url}")
print(f"API Key: {api_key[:5]}...{api_key[-3:]}")
print(f"Model: {data['model']}")
print()

try:
    print("📤 Envoi de la requête...")
    response = requests.post(url, headers=headers, json=data, verify=False, timeout=30)
    
    print(f"Status code: {response.status_code}")
    print(f"Response headers: {dict(response.headers)}")
    print()
    
    if response.status_code == 200:
        result = response.json()
        print("✅ Succès !")
        print(f"Réponse: {result['choices'][0]['message']['content']}")
        print()
        print("Détails complets:")
        print(f"  Model utilisé: {result.get('model')}")
        print(f"  Tokens: {result.get('usage', {})}")
    else:
        print(f"❌ Erreur {response.status_code}")
        print(f"Body: {response.text}")
        
except requests.exceptions.Timeout:
    print("❌ Timeout - L'API ne répond pas")
except requests.exceptions.ConnectionError as e:
    print(f"❌ Erreur de connexion: {e}")
except Exception as e:
    print(f"❌ Erreur inattendue: {e}")