module.exports = (sequelize, DataTypes) => {
  const Claim = sequelize.define('Claim', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    patient_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    patient_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    doctor_id: {
      type: DataTypes.STRING,
      allowNull: false
    },
    provider_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    diagnosis: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    medications: {
      type: DataTypes.JSON,
      allowNull: false
    },
    document_path: {
      type: DataTypes.STRING,
      allowNull: false
    },
    total_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    insurance_covered: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    patient_responsibility: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    service_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending'
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    }
  }, {
    underscored: true,
    timestamps: true,
    validate: {
      checkRequiredFields() {
        const requiredFields = [
          'patient_name', 'provider_name', 'document_path',
          'diagnosis', 'total_amount', 'insurance_covered',
          'patient_responsibility'
        ];
        
        requiredFields.forEach(field => {
          if (this[field] === null || this[field] === undefined) {
            throw new Error(`${field} cannot be null`);
          }
        });
      }
    }
  });

  return Claim;
};