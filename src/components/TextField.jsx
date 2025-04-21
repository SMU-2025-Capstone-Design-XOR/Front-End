import React from 'react';
import PropTypes from 'prop-types';
import '../css/login.css';

export const TextField = ({ id, label, type = 'text', value, onChange }) => {
  return (
    <div className="text-field-wrapper">
      <label htmlFor={id} className="text-field-label">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        className="text-field-input"
        required
      />
    </div>
  );
};

TextField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  type: PropTypes.string,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
};

export default TextField;