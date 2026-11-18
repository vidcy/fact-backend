import { Injectable } from '@nestjs/common';

@Injectable()
export class NumberToWordsService {
  private unidades = [
    '',
    'UN',
    'DOS',
    'TRES',
    'CUATRO',
    'CINCO',
    'SEIS',
    'SIETE',
    'OCHO',
    'NUEVE',
  ];
  private decenas = [
    'DIEZ',
    'ONCE',
    'DOCE',
    'TRECE',
    'CATORCE',
    'QUINCE',
    'DIECISEIS',
    'DIECISIETE',
    'DIECIOCHO',
    'DIECINUEVE',
  ];
  private decenasPuras = [
    '',
    '',
    'VEINTE',
    'TREINTA',
    'CUARENTA',
    'CINCUENTA',
    'SESENTA',
    'SETENTA',
    'OCHENTA',
    'NOVENTA',
  ];
  private centenas = [
    '',
    'CIENTO',
    'DOSCIENTOS',
    'TRESCIENTOS',
    'CUATROCIENTOS',
    'QUINIENTOS',
    'SEISCIENTOS',
    'SETECIENTOS',
    'OCHOCIENTOS',
    'NOVECIENTOS',
  ];

  public convert(amount: number, currency: string = 'PEN'): string {
    const safeAmount = Math.abs(amount);
    const enteros = Math.floor(safeAmount);
    const decimales = Math.round((safeAmount - enteros) * 100);
    const strDecimales = String(decimales).padStart(2, '0');

    const currencyText = currency === 'USD' ? 'DÓLARES AMERICANOS' : 'SOLES';
    if (enteros === 0) {
      return `SON: CERO CON ${strDecimales}/100 ${currencyText}`;
    }

    const textoEnteros = this.convertNumber(enteros);
    return `SON: ${textoEnteros} CON ${strDecimales}/100 ${currencyText}`;
  }

  private convertNumber(n: number): string {
    if (n === 100) return 'CIEN';
    if (n < 10) return this.unidades[n];
    if (n >= 10 && n < 20) return this.decenas[n - 10];
    if (n >= 20 && n < 30) {
      if (n === 20) return 'VEINTE';
      return `VEINTI${this.unidades[n - 20]}`;
    }
    if (n >= 30 && n < 100) {
      const u = n % 10;
      const d = Math.floor(n / 10);
      return u === 0 ? this.decenasPuras[d] : `${this.decenasPuras[d]} Y ${this.unidades[u]}`;
    }
    if (n >= 100 && n < 1000) {
      const c = Math.floor(n / 100);
      const resto = n % 100;
      return resto === 0 ? (n === 100 ? 'CIEN' : this.centenas[c]) : `${this.centenas[c]} ${this.convertNumber(resto)}`;
    }
    if (n >= 1000 && n < 1000000) {
      const miles = Math.floor(n / 1000);
      const resto = n % 1000;
      const milesText = miles === 1 ? 'MIL' : `${this.convertNumber(miles)} MIL`;
      return resto === 0 ? milesText : `${milesText} ${this.convertNumber(resto)}`;
    }
    if (n >= 1000000 && n < 1000000000) {
      const millones = Math.floor(n / 1000000);
      const resto = n % 1000000;
      const millonText = millones === 1 ? 'UN MILLÓN' : `${this.convertNumber(millones)} MILLONES`;
      return resto === 0 ? millonText : `${millonText} ${this.convertNumber(resto)}`;
    }
    return String(n);
  }
}
