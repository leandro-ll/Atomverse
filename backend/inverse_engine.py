# inverse_engine.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
import os
import re
import json
import google.generativeai as genai
from dotenv import load_dotenv
from chempy import Substance, Reaction, Equilibrium

load_dotenv()

router = APIRouter()

# Cek API Key
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("⚠️ PERINGATAN: GEMINI_API_KEY tidak ditemukan di file .env!")
else:
    genai.configure(api_key=api_key)

CHEMICAL_KNOWLEDGE_BASE = [
    {
        "id": "rxn_001",
        "name": "Pembentukan Endapan Perak Klorida",
        "reactants": ["AgNO3", "NaCl"],
        "properties": {"color": "putih", "precipitate": "AgCl", "ph_final": "7.0"}
    },
    {
        "id": "rxn_002",
        "name": "Pembentukan Endapan Timbal Iodida",
        "reactants": ["Pb(NO3)2", "KI"],
        "properties": {"color": "kuning", "precipitate": "PbI2", "ph_final": "7.0"}
    },
    {
        "id": "rxn_003",
        "name": "Reaksi Netralisasi Asam Basa",
        "reactants": ["HCl", "NaOH"],
        "properties": {"color": "bening", "precipitate": None, "ph_final": "7.0", "energy": "Eksoterm"}
    }
]

# ChemPy-based reaction utilities
class ChemistryEngine:
    """Engine untuk perhitungan kimia menggunakan chempy library"""
    
    @staticmethod
    def get_molar_mass(formula: str) -> float:
        """Menghitung massa molar dari formula kimia"""
        try:
            substance = Substance.from_formula(formula)
            return substance.mass
        except Exception as e:
            print(f"⚠️ Error calculating molar mass for {formula}: {e}")
            return 0.0
    
    @staticmethod
    def create_reaction(reactants: Dict[str, int], products: Dict[str, int]) -> Reaction:
        """Membuat objek reaksi dari dictionary stoikiometri"""
        try:
            return Reaction(reactants, products)
        except Exception as e:
            print(f"⚠️ Error creating reaction: {e}")
            return None
    
    @staticmethod
    def balance_reaction(reaction: Reaction) -> bool:
        """Memeriksa apakah reaksi sudah seimbang"""
        if reaction is None:
            return False
        try:
            return reaction.check_charge_balance() and reaction.check_mass_balance()
        except Exception as e:
            print(f"⚠️ Error checking reaction balance: {e}")
            return False
    
    @staticmethod
    def calculate_stoichiometry(reaction: Reaction, amount: float, unit: str = 'mol') -> Dict:
        """Menghitung jumlah produk berdasarkan stoikiometri reaksi"""
        if reaction is None or amount <= 0:
            return {}
        
        try:
            results = {}
            # Hitung rasio stoikiometri untuk setiap komponen
            for key in reaction.keys():
                coeff = reaction.coeffs[key]
                if unit == 'mol':
                    results[key] = coeff * amount
                elif unit == 'gram':
                    molar_mass = ChemistryEngine.get_molar_mass(key)
                    results[key] = coeff * amount * molar_mass
            return results
        except Exception as e:
            print(f"⚠️ Error calculating stoichiometry: {e}")
            return {}
    
    @staticmethod
    def get_precipitate_info(precipitate_formula: str) -> Dict:
        """Mendapatkan informasi tentang endapan"""
        try:
            substance = Substance.from_formula(precipitate_formula)
            return {
                "formula": precipitate_formula,
                "molar_mass": substance.mass,
                "composition": dict(substance.composition)
            }
        except Exception as e:
            print(f"⚠️ Error getting precipitate info: {e}")
            return {"formula": precipitate_formula, "error": str(e)}
    
    @staticmethod
    def validate_reaction_feasibility(reactants: list, products: list) -> Dict:
        """Validasi kelayakan reaksi berdasarkan hukum kekekalan massa"""
        try:
            # Hitung total atom di sisi reaktan
            reactant_atoms = {}
            for formula in reactants:
                substance = Substance.from_formula(formula)
                for element, count in substance.composition.items():
                    reactant_atoms[element] = reactant_atoms.get(element, 0) + count
            
            # Hitung total atom di sisi produk
            product_atoms = {}
            for formula in products:
                substance = Substance.from_formula(formula)
                for element, count in substance.composition.items():
                    product_atoms[element] = product_atoms.get(element, 0) + count
            
            # Cek kesetimbangan
            is_balanced = reactant_atoms == product_atoms
            
            return {
                "is_balanced": is_balanced,
                "reactant_composition": reactant_atoms,
                "product_composition": product_atoms,
                "feasible": is_balanced
            }
        except Exception as e:
            print(f"⚠️ Error validating reaction: {e}")
            return {"is_balanced": False, "error": str(e), "feasible": False}


class InverseRequest(BaseModel):
    goal: str
    constraints: Optional[Dict] = None

class InverseResponse(BaseModel):
    confidence_score: int
    recommended_reaction: str
    configuration: Dict
    predicted_outcome: Dict
    explanation: str

@router.post("/api/inverse-experiment", response_model=InverseResponse)
async def solve_inverse_experiment(request: InverseRequest):
    try:
        print(f"📥 Menerima request: {request.goal}")
        
        # 1. Rule-Based Filtering
        relevant_reactions = []
        goal_lower = request.goal.lower()
        for rxn in CHEMICAL_KNOWLEDGE_BASE:
            props = json.dumps(rxn['properties']).lower()
            if any(keyword in props for keyword in goal_lower.split()):
                relevant_reactions.append(rxn)
        
        if not relevant_reactions:
            relevant_reactions = CHEMICAL_KNOWLEDGE_BASE[:2] 

        # 2. ChemPy Validation - Validate reaction feasibility using chempy
        chempy_validation = None
        if relevant_reactions:
            first_rxn = relevant_reactions[0]
            reactants = first_rxn.get('reactants', [])
            precipitate = first_rxn.get('properties', {}).get('precipitate')
            products = [precipitate] if precipitate else []
            
            if reactants and products:
                chempy_validation = ChemistryEngine.validate_reaction_feasibility(reactants, products)
                print(f"🧪 ChemPy Validation Result: {chempy_validation}")
                
                # Get additional chempy data
                if precipitate:
                    precipitate_info = ChemistryEngine.get_precipitate_info(precipitate)
                    print(f"🔬 Precipitate Info from ChemPy: {precipitate_info}")

        # 3. LLM Reasoning with ChemPy-enhanced context
        chempy_context = ""
        if chempy_validation:
            chempy_context = f"""
            VALIDASI CHEMPY:
            - Reaksi Seimbang: {chempy_validation.get('is_balanced', False)}
            - Komposisi Reaktan: {chempy_validation.get('reactant_composition', {})}
            - Komposisi Produk: {chempy_validation.get('product_composition', {})}
            """
        
        prompt = f"""
        Kamu adalah ATOMVERSE AI Inverse Problem Solver.
        TUJUAN PENGGUNA: "{request.goal}"
        DATABASE REAKSI: {json.dumps(relevant_reactions, indent=2)}
        {chempy_context}
        
        RESPON HANYA DALAM FORMAT JSON MURNI (tanpa markdown ```json):
        {{
            "confidence_score": 92,
            "recommended_reaction": "Nama Reaksi",
            "configuration": {{
                "reactant_a": "AgNO3", "conc_a": 0.5, "unit_conc": "M", "vol_a": 50, "unit_vol": "mL",
                "reactant_b": "NaCl", "conc_b": 0.5, "unit_conc": "M", "vol_b": 50, "unit_vol": "mL",
                "temp": 25, "unit_temp": "°C", "pressure": 1, "unit_press": "atm"
            }},
            "predicted_outcome": {{
                "color": "...", "precipitate": "...", "gas": "...", "ph_final": "..."
            }},
            "explanation": "Penjelasan singkat..."
        }}
        """

        model = genai.GenerativeModel('gemini-3.1-flash-lite')
        response = model.generate_content(prompt)
        print(f"📤 Raw Response dari AI:\n{response.text}")
        
        # 4. Parse JSON dengan aman
        json_match = re.search(r'\{[\s\S]*\}', response.text)
        if json_match:
            try:
                result_data = json.loads(json_match.group())
                print("✅ Berhasil parse JSON!")
                
                # Add ChemPy validation data to response if available
                if chempy_validation:
                    result_data['chempy_validation'] = chempy_validation
                
                return InverseResponse(**result_data)
            except json.JSONDecodeError as e:
                print(f"❌ Gagal parse JSON: {e}")
                print(f"Isi yang dicoba di-parse: {json_match.group()}")
                raise HTTPException(status_code=500, detail="AI mengembalikan format JSON yang tidak valid")
        else:
            raise HTTPException(status_code=500, detail="AI tidak mengembalikan format JSON sama sekali")

    except Exception as e:
        print(f"❌ CRITICAL ERROR di Backend: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Additional endpoint for direct ChemPy calculations
@router.post("/api/chemistry/calculate")
async def calculate_chemistry(
    reactants: Optional[list] = None,
    products: Optional[list] = None,
    formula: Optional[str] = None,
    calculation_type: str = "validate"
):
    """Endpoint untuk perhitungan kimia langsung menggunakan ChemPy"""
    try:
        result = {}
        
        if calculation_type == "validate" and reactants and products:
            result = ChemistryEngine.validate_reaction_feasibility(reactants, products)
        
        elif calculation_type == "molar_mass" and formula:
            molar_mass = ChemistryEngine.get_molar_mass(formula)
            result = {"formula": formula, "molar_mass": molar_mass}
        
        elif calculation_type == "precipitate" and formula:
            result = ChemistryEngine.get_precipitate_info(formula)
        
        else:
            raise HTTPException(status_code=400, detail="Invalid calculation type or missing parameters")
        
        return result
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ ERROR in chemistry calculation: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
