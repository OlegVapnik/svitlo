import { useState } from 'react';

const ADDRESS_KEY = 'myAddress';

export function useMyAddress() {
  const [address, setAddressState] = useState(() => localStorage.getItem(ADDRESS_KEY) || '');

  const setAddress = (value: string) => {
    setAddressState(value);
    localStorage.setItem(ADDRESS_KEY, value);
  };
  const clearAddress = () => {
    setAddressState('');
    localStorage.removeItem(ADDRESS_KEY);
    localStorage.removeItem('myAccountNumber');
  };

  return { address, setAddress, clearAddress };
}
